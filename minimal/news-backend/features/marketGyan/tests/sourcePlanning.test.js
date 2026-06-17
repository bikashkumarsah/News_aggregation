const test = require('node:test');
const assert = require('node:assert/strict');

const {
    planSourceTargets,
    sourceKeyFromName,
    sourceNameFilter
} = require('../services/sourcePlanningService');

test('source names map to stable corpus buckets', () => {
    assert.equal(sourceKeyFromName('ShareSansar'), 'sharesansar');
    assert.equal(sourceKeyFromName('बिजनेस – Online Khabar'), 'onlinekhabar');
    assert.equal(sourceKeyFromName('The Kathmandu Post - Money'), 'kathmandupost');
    assert.equal(sourceKeyFromName('Nepal Rastra Bank'), 'regulatory');
    assert.match('SEBON', sourceNameFilter('regulatory'));
});

test('source planner fills unavailable quotas without exceeding the 60 percent cap', () => {
    const plan = planSourceTargets({
        target: 450,
        current: {
            sharesansar: 0,
            onlinekhabar: 55,
            kathmandupost: 20,
            regulatory: 3
        },
        available: {
            sharesansar: 350,
            onlinekhabar: 200,
            kathmandupost: 0,
            regulatory: 5
        }
    });

    assert.equal(plan.achievable, true);
    assert.equal(Object.values(plan.finalTargets).reduce((sum, value) => sum + value, 0), 450);
    assert.ok(plan.finalTargets.sharesansar <= 270);
    assert.ok(plan.finalTargets.onlinekhabar <= 270);
    assert.equal(plan.finalTargets.kathmandupost, 20);
});

test('source planner reports a shortfall when the collected corpus is too small', () => {
    const plan = planSourceTargets({
        target: 450,
        current: {},
        available: {
            sharesansar: 100,
            onlinekhabar: 100,
            kathmandupost: 20,
            regulatory: 10
        }
    });

    assert.equal(plan.achievable, false);
    assert.equal(plan.shortfall, 220);
});
