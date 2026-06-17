import argparse
import json
import shutil
from pathlib import Path


def format_example(row, tokenizer, compact_label):
    prompt = (
        "Return only compact NEPSE-Impact JSON. Do not give investment advice.\n"
        "Title: %s\nText: %s" % (row["title"], row["excerpt"])
    )
    response = json.dumps(
        compact_label(row["gold"]),
        ensure_ascii=False,
        sort_keys=True,
    )
    messages = [
        {"role": "user", "content": prompt},
        {"role": "assistant", "content": response},
    ]
    return tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=False,
        enable_thinking=False,
    )


def oversample_training_rows(rows):
    selected = list(rows)
    selected.extend(
        row for row in rows
        if row["gold"]["relevance"] in {"indirect", "not_relevant"}
    )
    selected.extend(
        row for row in rows
        if (
            row["gold"]["relevance"] == "not_relevant"
            and row["gold"]["language"] == "ne"
        )
    )
    return selected


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", required=True)
    parser.add_argument("--validation", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="Qwen/Qwen3-8B")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    import torch
    from datasets import Dataset
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from transformers import (
        AutoModelForCausalLM,
        AutoTokenizer,
        BitsAndBytesConfig,
        DataCollatorForLanguageModeling,
        Trainer,
        TrainingArguments,
        set_seed,
    )
    from .dataset import compact_qwen_label, read_jsonl

    set_seed(args.seed)
    tokenizer = AutoTokenizer.from_pretrained(args.model)
    tokenizer.pad_token = tokenizer.eos_token
    use_bf16 = torch.cuda.is_available() and torch.cuda.is_bf16_supported()
    compute_dtype = torch.bfloat16 if use_bf16 else torch.float16

    def prepare(path, oversample=False):
        rows = read_jsonl(path)
        if oversample:
            rows = oversample_training_rows(rows)
        dataset = Dataset.from_list([{
            "text": format_example(row, tokenizer, compact_qwen_label)
        } for row in rows])

        def tokenize(batch):
            return tokenizer(
                batch["text"],
                truncation=True,
                max_length=1024,
                padding=False,
            )

        return dataset.map(tokenize, batched=True, remove_columns=["text"])

    quantization = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=compute_dtype,
        bnb_4bit_use_double_quant=True,
    )
    model = AutoModelForCausalLM.from_pretrained(
        args.model,
        quantization_config=quantization,
        device_map="auto",
    )
    model = prepare_model_for_kbit_training(model)
    model.gradient_checkpointing_enable()
    model = get_peft_model(model, LoraConfig(
        r=16,
        lora_alpha=32,
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=[
            "q_proj",
            "k_proj",
            "v_proj",
            "o_proj",
            "gate_proj",
            "up_proj",
            "down_proj",
        ],
    ))

    output = Path(args.output)
    training_args = TrainingArguments(
        output_dir=str(output),
        per_device_train_batch_size=1,
        per_device_eval_batch_size=1,
        gradient_accumulation_steps=16,
        learning_rate=2e-4,
        num_train_epochs=3,
        warmup_ratio=0.05,
        logging_steps=5,
        eval_strategy="steps",
        eval_steps=25,
        save_strategy="no",
        bf16=use_bf16,
        fp16=torch.cuda.is_available() and not use_bf16,
        optim="paged_adamw_8bit",
        report_to=[],
        seed=args.seed,
    )
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=prepare(args.train, oversample=True),
        eval_dataset=prepare(args.validation),
        data_collator=DataCollatorForLanguageModeling(tokenizer, mlm=False),
    )
    if output.exists():
        for checkpoint in output.glob("checkpoint-*"):
            shutil.rmtree(checkpoint, ignore_errors=True)
    trainer.train()
    trainer.save_model()
    tokenizer.save_pretrained(output)
    for checkpoint in output.glob("checkpoint-*"):
        shutil.rmtree(checkpoint, ignore_errors=True)


if __name__ == "__main__":
    main()
