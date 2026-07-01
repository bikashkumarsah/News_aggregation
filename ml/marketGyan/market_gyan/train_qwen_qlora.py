import argparse
import json
import os
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


def main():
    from .qwen_training import (
        assert_targeted_v2_frozen_split,
        env_bool,
        load_split_manifest_hash,
        oversample_training_rows,
        oversampling_summary,
        qwen_training_profile,
    )

    parser = argparse.ArgumentParser()
    parser.add_argument("--train", required=True)
    parser.add_argument("--validation", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument(
        "--model",
        default=os.getenv("MARKET_GYAN_QWEN_MODEL", "Qwen/Qwen3.5-9B"),
    )
    parser.add_argument(
        "--load-in-4bit",
        action="store_true",
        default=os.getenv("MARKET_GYAN_LOAD_IN_4BIT", "false").lower()
        in {"1", "true", "yes"},
        help="Use 4-bit QLoRA for low-memory diagnostic runs.",
    )
    parser.add_argument(
        "--max-seq-length",
        type=int,
        default=int(os.getenv("MARKET_GYAN_MAX_SEQ_LENGTH", "1536")),
    )
    parser.add_argument(
        "--epochs",
        type=float,
        default=float(os.getenv("MARKET_GYAN_EPOCHS", "3")),
    )
    parser.add_argument(
        "--learning-rate",
        type=float,
        default=None,
    )
    parser.add_argument(
        "--gradient-accumulation-steps",
        type=int,
        default=int(os.getenv("MARKET_GYAN_GRADIENT_ACCUMULATION_STEPS", "16")),
    )
    parser.add_argument(
        "--per-device-train-batch-size",
        type=int,
        default=int(os.getenv("MARKET_GYAN_PER_DEVICE_TRAIN_BATCH_SIZE", "1")),
    )
    parser.add_argument(
        "--per-device-eval-batch-size",
        type=int,
        default=int(os.getenv("MARKET_GYAN_PER_DEVICE_EVAL_BATCH_SIZE", "1")),
    )
    parser.add_argument(
        "--eval-steps",
        type=int,
        default=int(os.getenv("MARKET_GYAN_EVAL_STEPS", "25")),
    )
    parser.add_argument(
        "--logging-steps",
        type=int,
        default=int(os.getenv("MARKET_GYAN_LOGGING_STEPS", "5")),
    )
    parser.add_argument(
        "--dataloader-num-workers",
        type=int,
        default=int(os.getenv("MARKET_GYAN_DATALOADER_NUM_WORKERS", "0")),
    )
    parser.add_argument(
        "--dataset-num-proc",
        type=int,
        default=int(os.getenv("MARKET_GYAN_DATASET_NUM_PROC", "1")),
    )
    parser.add_argument(
        "--optim",
        default=os.getenv("MARKET_GYAN_OPTIM", "paged_adamw_8bit"),
    )
    parser.add_argument(
        "--oversample-profile",
        choices=("none", "legacy", "targeted_v2"),
        default=os.getenv("MARKET_GYAN_OVERSAMPLE_PROFILE", "legacy"),
    )
    parser.add_argument(
        "--save-best-model",
        action="store_true",
        default=env_bool("MARKET_GYAN_SAVE_BEST_MODEL", False),
    )
    parser.add_argument(
        "--no-save-best-model",
        action="store_false",
        dest="save_best_model",
    )
    parser.add_argument(
        "--split-manifest",
        default=os.getenv("MARKET_GYAN_SPLIT_MANIFEST", ""),
    )
    parser.add_argument(
        "--lora-r",
        type=int,
        default=int(os.getenv("MARKET_GYAN_LORA_R", "16")),
    )
    parser.add_argument(
        "--lora-alpha",
        type=int,
        default=None,
    )
    parser.add_argument(
        "--lora-dropout",
        type=float,
        default=float(os.getenv("MARKET_GYAN_LORA_DROPOUT", "0.05")),
    )
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
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    use_bf16 = torch.cuda.is_available() and torch.cuda.is_bf16_supported()
    compute_dtype = torch.bfloat16 if use_bf16 else torch.float16

    train_rows = read_jsonl(args.train)
    validation_rows = read_jsonl(args.validation)
    weighted_train_rows = oversample_training_rows(
        train_rows,
        profile=args.oversample_profile,
    )
    oversampling = oversampling_summary(train_rows, args.oversample_profile)
    split_manifest_path = (
        Path(args.split_manifest)
        if args.split_manifest
        else Path(args.train).with_name("manifest.json")
    )
    split_manifest_hash = load_split_manifest_hash(split_manifest_path)
    assert_targeted_v2_frozen_split(oversampling, split_manifest_hash)

    def prepare_rows(rows):
        dataset = Dataset.from_list([{
            "text": format_example(row, tokenizer, compact_qwen_label)
        } for row in rows])

        def tokenize(batch):
            return tokenizer(
                batch["text"],
                truncation=True,
                max_length=args.max_seq_length,
                padding=False,
            )

        num_proc = args.dataset_num_proc if args.dataset_num_proc > 1 else None
        return dataset.map(
            tokenize,
            batched=True,
            remove_columns=["text"],
            num_proc=num_proc,
        )

    model_kwargs = {"device_map": "auto"}
    if args.load_in_4bit:
        model_kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=compute_dtype,
            bnb_4bit_use_double_quant=True,
        )
    else:
        model_kwargs["torch_dtype"] = compute_dtype
    model = AutoModelForCausalLM.from_pretrained(args.model, **model_kwargs)
    if args.load_in_4bit:
        model = prepare_model_for_kbit_training(model)
    model.gradient_checkpointing_enable()
    lora_alpha = args.lora_alpha or args.lora_r * 2
    model = get_peft_model(model, LoraConfig(
        r=args.lora_r,
        lora_alpha=lora_alpha,
        lora_dropout=args.lora_dropout,
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
    learning_rate = args.learning_rate
    if learning_rate is None:
        learning_rate = 1e-4 if args.load_in_4bit else 5e-5
    training_args_kwargs = dict(
        output_dir=str(output),
        per_device_train_batch_size=args.per_device_train_batch_size,
        per_device_eval_batch_size=args.per_device_eval_batch_size,
        gradient_accumulation_steps=args.gradient_accumulation_steps,
        learning_rate=learning_rate,
        num_train_epochs=args.epochs,
        warmup_ratio=0.05,
        logging_steps=args.logging_steps,
        eval_strategy="steps",
        eval_steps=args.eval_steps,
        save_strategy="steps" if args.save_best_model else "no",
        bf16=use_bf16,
        fp16=torch.cuda.is_available() and not use_bf16,
        optim=args.optim,
        dataloader_num_workers=args.dataloader_num_workers,
        dataloader_pin_memory=torch.cuda.is_available(),
        report_to=[],
        seed=args.seed,
    )
    if args.save_best_model:
        training_args_kwargs.update({
            "save_steps": args.eval_steps,
            "save_total_limit": 2,
            "load_best_model_at_end": True,
            "metric_for_best_model": "eval_loss",
            "greater_is_better": False,
        })
    training_args = TrainingArguments(**training_args_kwargs)
    output.mkdir(parents=True, exist_ok=True)
    training_profile = qwen_training_profile(
        model_name=args.model,
        output_name=output.name,
        load_in_4bit=args.load_in_4bit,
        max_seq_length=args.max_seq_length,
        oversampling=oversampling,
        split_manifest_hash=split_manifest_hash,
        extra={
            "epochs": args.epochs,
            "learningRate": learning_rate,
            "loraR": args.lora_r,
            "loraAlpha": lora_alpha,
            "loraDropout": args.lora_dropout,
            "perDeviceTrainBatchSize": args.per_device_train_batch_size,
            "perDeviceEvalBatchSize": args.per_device_eval_batch_size,
            "gradientAccumulationSteps": args.gradient_accumulation_steps,
            "evalSteps": args.eval_steps,
            "saveBestModel": args.save_best_model,
            "optimizer": args.optim,
            "seed": args.seed,
        },
    )
    (output / "training_profile.json").write_text(
        json.dumps(training_profile, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=prepare_rows(weighted_train_rows),
        eval_dataset=prepare_rows(validation_rows),
        data_collator=DataCollatorForLanguageModeling(tokenizer, mlm=False),
    )
    if output.exists():
        for checkpoint in output.glob("checkpoint-*"):
            shutil.rmtree(checkpoint, ignore_errors=True)
    trainer.train()
    trainer.save_model(str(output))
    tokenizer.save_pretrained(output)
    processor_config = output / "processor_config.json"
    if processor_config.exists():
        processor_config.unlink()
    for checkpoint in output.glob("checkpoint-*"):
        shutil.rmtree(checkpoint, ignore_errors=True)


if __name__ == "__main__":
    main()
