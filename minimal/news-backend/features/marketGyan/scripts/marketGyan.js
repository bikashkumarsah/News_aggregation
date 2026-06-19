#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
    exportApprovedLabels,
    processQueuedLabels,
    queueBalancedDocuments,
    queueDocuments,
    retryFailedLabels
} = require('../services/labelQueueService');
const { marketGyanConfig } = require('../config');
const { getCorpusStatus } = require('../services/corpusStatusService');
const {
    planImpactCorpusFromDatabase
} = require('../services/corpusSelectionService');
const { runIngestion } = require('../services/ingestionService');
const { indexMarketDocuments } = require('../services/marketQdrantService');
const { generateDailyReport } = require('../services/reportService');
const { syncSecurityAliases } = require('../services/ontologyService');
const {
    computeMarketReactions,
    exportMarketReactions
} = require('../services/marketReactionService');
const {
    applyAssistantReviews,
    exportAssistantReviewBatch
} = require('../services/assistantReviewService');
const {
    batchAdjudicateSubmitted,
    rebalanceAudit
} = require('../services/goldDatasetService');
const {
    importRevalidationAudit
} = require('../services/revalidationAuditService');
const {
    applyGoldRebalancePatch
} = require('../services/rebalancePatchService');
const {
    connectMongo,
    disconnectMongo,
    withMongoRetry
} = require('../services/mongoConnectionService');

const args = process.argv.slice(2);
const command = args[0];
const options = Object.fromEntries(args.slice(1).map((argument) => {
    const [key, ...rest] = argument.replace(/^--/, '').split('=');
    return [key, rest.join('=') || true];
}));

const today = () => new Date().toISOString().slice(0, 10);
const parseSources = (value) => String(value || '')
    .split(',')
    .map((source) => source.trim().toLowerCase())
    .filter(Boolean);
const numberOption = (name) => options[name] === undefined
    ? undefined
    : Number(options[name]);

const structuringConfig = ({
    schemaVersion = options['schema-version'],
    promptVersion = options['prompt-version']
} = {}) => ({
    ...marketGyanConfig,
    schemaVersion: Number(schemaVersion || marketGyanConfig.schemaVersion),
    promptVersion: String(promptVersion || marketGyanConfig.promptVersion)
});

const v2Config = () => structuringConfig({
    schemaVersion: 2,
    promptVersion: 'market-impact-v2'
});

const documentOptions = () => ({
    all: {
        maxPages: numberOption('max-pages'),
        limit: numberOption('source-limit')
    },
    sharesansar: {
        maxPages: numberOption('sharesansar-max-pages'),
        limit: numberOption('sharesansar-limit')
    },
    onlinekhabar: {
        startPage: numberOption('onlinekhabar-start-page'),
        maxPages: numberOption('onlinekhabar-max-pages'),
        limit: numberOption('onlinekhabar-limit')
    },
    kathmandupost: {
        limit: numberOption('kathmandupost-limit')
    },
    regulatory: {
        maxPages: numberOption('regulatory-max-pages'),
        limit: numberOption('regulatory-limit')
    }
});

const withoutUndefined = (value) => Object.fromEntries(
    Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [
            key,
            item && typeof item === 'object' && !Array.isArray(item)
                ? withoutUndefined(item)
                : item
        ])
);

const writeJson = (value) => {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const writeExport = async (rows) => {
    const output = rows.map((row) => JSON.stringify(row)).join('\n');
    if (!options.output) {
        process.stdout.write(output ? `${output}\n` : '');
        return;
    }
    const target = path.resolve(process.cwd(), String(options.output));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, output ? `${output}\n` : '', 'utf8');
    writeJson({ exported: rows.length, output: target });
};

const writeJsonFile = (value, output) => {
    const target = path.resolve(process.cwd(), String(output));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    return target;
};

const main = async () => {
    if (command === 'process') {
        await withMongoRetry(
            () => connectMongo(),
            {
                maxAttempts: Infinity,
                operationName: 'Starting the Market Gyan MongoDB connection'
            }
        );
    } else {
        await connectMongo();
    }

    switch (command) {
        case 'ingest': {
            const date = options.date || today();
            writeJson(await runIngestion({
                from: date,
                to: date,
                mode: 'daily',
                includeMarket: options['document-only'] !== 'true',
                documentSources: parseSources(options.sources),
                documentOptions: withoutUndefined(documentOptions()),
                force: options.force === 'true'
            }));
            break;
        }
        case 'backfill': {
            if (!options.from || !options.to) {
                throw new Error('backfill requires --from=YYYY-MM-DD and --to=YYYY-MM-DD');
            }
            writeJson(await runIngestion({
                from: options.from,
                to: options.to,
                mode: 'backfill',
                includeMarket: options['document-only'] !== 'true',
                documentSources: parseSources(options.sources),
                documentOptions: withoutUndefined(documentOptions()),
                force: options.force === 'true'
            }));
            break;
        }
        case 'queue':
            writeJson(await queueDocuments({
                limit: options.limit,
                source: options.source,
                config: structuringConfig()
            }));
            break;
        case 'queue-balanced':
            writeJson(await queueBalancedDocuments({
                target: options.target,
                config: structuringConfig()
            }));
            break;
        case 'select-v2': {
            const plan = await planImpactCorpusFromDatabase({
                from: options.from,
                to: options.to,
                secondReviewTarget: numberOption('second-review-target')
            });
            if (options.output) {
                const target = path.resolve(process.cwd(), String(options.output));
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.writeFileSync(target, JSON.stringify(plan, null, 2), 'utf8');
            }
            writeJson({
                target: plan.target,
                quotaCompliant: plan.quotaCompliant,
                quotaChecks: plan.quotaChecks,
                quotaDeficits: plan.quotaDeficits,
                availableCounts: plan.availableCounts,
                counts: plan.counts,
                shortfall: plan.shortfall,
                sourceCap: plan.sourceCap,
                output: options.output || null
            });
            break;
        }
        case 'queue-v2': {
            const plan = await planImpactCorpusFromDatabase({
                from: options.from,
                to: options.to,
                secondReviewTarget: numberOption('second-review-target')
            });
            if (!plan.quotaCompliant && options['allow-incomplete'] !== 'true') {
                throw new Error(
                    'V2 selection is not quota-compliant. Collect targeted replacements '
                    + 'or pass --allow-incomplete=true only for a smoke batch.'
                );
            }
            const selected = options.limit
                ? plan.selected.slice(0, Math.max(1, Number(options.limit)))
                : plan.selected;
            const selectionById = Object.fromEntries(
                selected.map((row) => [row.documentId, row])
            );
            const queued = await queueDocuments({
                documentIds: selected.map((row) => row.documentId),
                limit: selected.length,
                config: v2Config(),
                selectionById
            });
            writeJson({
                plan: {
                    target: plan.target,
                    quotaCompliant: plan.quotaCompliant,
                    quotaChecks: plan.quotaChecks,
                    quotaDeficits: plan.quotaDeficits,
                    availableCounts: plan.availableCounts,
                    counts: plan.counts,
                    shortfall: plan.shortfall
                },
                queued
            });
            break;
        }
        case 'process':
            writeJson(await processQueuedLabels({
                limit: options.limit,
                source: options.source,
                config: structuringConfig()
            }));
            break;
        case 'retry':
            writeJson(await retryFailedLabels({
                limit: options.limit,
                source: options.source,
                transientOnly: options['transient-only'] === 'true',
                maxAttempts: options['max-attempts'],
                config: structuringConfig()
            }));
            break;
        case 'assistant-review-export': {
            const rows = await exportAssistantReviewBatch({
                limit: options.limit
            });
            if (options.output) {
                writeJson({
                    exported: rows.length,
                    output: writeJsonFile(rows, options.output)
                });
            } else {
                writeJson(rows);
            }
            break;
        }
        case 'assistant-review-import': {
            if (!options.input) {
                throw new Error('assistant-review-import requires --input=path.json');
            }
            const input = path.resolve(process.cwd(), String(options.input));
            const rows = JSON.parse(fs.readFileSync(input, 'utf8'));
            writeJson(await applyAssistantReviews(rows, {
                reviewer: options.reviewer || 'codex'
            }));
            break;
        }
        case 'adjudicate-submitted':
            writeJson(await batchAdjudicateSubmitted({
                schemaVersion: Number(
                    options['schema-version'] || marketGyanConfig.schemaVersion
                ),
                reviewer: options.reviewer || 'adjudicator-1',
                dryRun: options['dry-run'] !== 'false',
                force: options.force === 'true',
                reason: options.reason
            }));
            break;
        case 'rebalance-audit':
            writeJson(await rebalanceAudit({
                schemaVersion: Number(
                    options['schema-version'] || marketGyanConfig.schemaVersion
                ),
                target: Number(options.target || marketGyanConfig.reviewTarget),
                basis: options.basis || 'gold'
            }));
            break;
        case 'rebalance-apply':
            writeJson(await applyGoldRebalancePatch({
                dryRun: options['dry-run'] !== 'false',
                reviewer: options.reviewer || 'rebalance-adjudicator',
                excludeCount: Number(options['exclude-count'] || 53)
            }));
            break;
        case 'import-revalidation-audit':
            writeJson(await importRevalidationAudit({
                auditPath: options.input
                    ? path.resolve(process.cwd(), String(options.input))
                    : undefined,
                schemaVersion: Number(
                    options['schema-version'] || marketGyanConfig.schemaVersion
                ),
                actor: options.reviewer || marketGyanConfig.reviewerId
            }));
            break;
        case 'status':
            writeJson(await getCorpusStatus({
                target: options.target || (
                    Number(options['schema-version'] || marketGyanConfig.schemaVersion) === 2
                        ? marketGyanConfig.reviewTarget
                        : 450
                ),
                schemaVersion: Number(
                    options['schema-version'] || marketGyanConfig.schemaVersion
                )
            }));
            break;
        case 'index':
            writeJson(await indexMarketDocuments({
                limit: options.limit,
                force: options.force === 'true'
            }));
            break;
        case 'report':
            writeJson(await generateDailyReport({
                date: options.date || new Date(),
                force: options.force === 'true'
            }));
            break;
        case 'export':
            await writeExport(await exportApprovedLabels({
                schemaVersion: Number(
                    options['schema-version'] || marketGyanConfig.schemaVersion
                )
            }));
            break;
        case 'reactions':
            writeJson(await computeMarketReactions({ limit: options.limit }));
            break;
        case 'sync-ontology':
            writeJson(await syncSecurityAliases());
            break;
        case 'export-reactions':
            await writeExport(await exportMarketReactions());
            break;
        default:
            throw new Error(
                'Usage: marketGyan.js ingest|backfill|queue|queue-balanced|select-v2|queue-v2|process|retry|assistant-review-export|assistant-review-import|adjudicate-submitted|rebalance-audit|rebalance-apply|import-revalidation-audit|status|index|report|reactions|sync-ontology|export-reactions|export [--key=value]'
            );
    }
};

main()
    .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await disconnectMongo();
    });
