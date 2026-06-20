const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const MarketLabel = require('../models/MarketLabel');
const { marketGyanConfig } = require('../config');

const DEFAULT_AUDIT_PATH = path.resolve(
    __dirname,
    '../../../../../docs/market-gyan/model-error-audit/training-run-error-audit.json'
);

const splitList = (value) => String(value || '')
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const normalizeAuditRows = (payload) => {
    const rows = Array.isArray(payload)
        ? payload
        : payload?.highestPriority || payload?.prioritySamples || [];
    return rows
        .map((row) => ({
            id: String(row.id || row.labelId || '').trim(),
            priorityScore: Number(row.priorityScore || 0),
            models: Array.isArray(row.models) ? row.models : splitList(row.models),
            reasons: Array.isArray(row.reasons) ? row.reasons : splitList(row.reasons)
        }))
        .filter((row) => mongoose.isValidObjectId(row.id));
};

const loadAuditRows = (auditPath = DEFAULT_AUDIT_PATH) => {
    const payload = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
    return normalizeAuditRows(payload);
};

const importRevalidationAudit = async ({
    auditPath = DEFAULT_AUDIT_PATH,
    schemaVersion = marketGyanConfig.schemaVersion,
    actor = marketGyanConfig.reviewerId,
    source = 'training-run-error-audit',
    force = false
} = {}) => {
    const rows = loadAuditRows(auditPath);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const ids = Array.from(byId.keys());
    if (!ids.length) {
        return {
            source,
            auditPath,
            imported: 0,
            auditRows: 0,
            missing: []
        };
    }

    const existing = await MarketLabel.find({
        _id: { $in: ids },
        'model.schemaVersion': Number(schemaVersion)
    }).select('_id revalidationAudit revisions.action').lean();
    const skippedActive = existing
        .filter((row) => (
            !force
            && row.revalidationAudit?.source === source
            && row.revalidationAudit?.needsReview === true
        ))
        .map((row) => row._id.toString());
    const skippedResolved = existing
        .filter((row) => (
            !force
            && row.revalidationAudit?.source === source
            && (
                row.revalidationAudit?.needsReview === false
                || (row.revisions || []).some(
                    (revision) => revision.action === 'revalidation_resolved'
                )
            )
        ))
        .map((row) => row._id.toString());
    const skippedActiveIds = new Set(skippedActive);
    const skippedResolvedIds = new Set(skippedResolved);
    const existingIds = new Set(
        existing
            .map((row) => row._id.toString())
            .filter((id) => !skippedActiveIds.has(id))
            .filter((id) => !skippedResolvedIds.has(id))
    );
    const now = new Date();
    const operations = ids
        .filter((id) => existingIds.has(id))
        .map((id) => {
            const row = byId.get(id);
            return {
                updateOne: {
                    filter: { _id: id },
                    update: {
                        $set: {
                            'revalidationAudit.needsReview': true,
                            'revalidationAudit.source': source,
                            'revalidationAudit.priorityScore': row.priorityScore,
                            'revalidationAudit.models': row.models,
                            'revalidationAudit.reasons': row.reasons,
                            'revalidationAudit.importedAt': now,
                            'revalidationAudit.importedBy': actor
                        },
                        $unset: {
                            'revalidationAudit.resolvedAt': 1,
                            'revalidationAudit.resolvedBy': 1
                        },
                        $push: {
                            revisions: {
                                action: 'revalidation_flagged',
                                reason: row.reasons.join('; ').slice(0, 1000),
                                actor,
                                at: now
                            }
                        }
                    }
                }
            };
        });

    const result = operations.length
        ? await MarketLabel.bulkWrite(operations, { ordered: false })
        : { matchedCount: 0, modifiedCount: 0 };

    return {
        source,
        auditPath,
        auditRows: rows.length,
        imported: operations.length,
        matched: result.matchedCount || operations.length,
        modified: result.modifiedCount || 0,
        skippedActive: skippedActive.length,
        skippedResolved: skippedResolved.length,
        missing: ids
            .filter((id) => !existingIds.has(id))
            .filter((id) => !skippedActiveIds.has(id))
            .filter((id) => !skippedResolvedIds.has(id))
    };
};

module.exports = {
    DEFAULT_AUDIT_PATH,
    importRevalidationAudit,
    loadAuditRows,
    normalizeAuditRows
};
