import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeNextVersion } from '../src/version.js';
import { getVersionName } from '../src/version-names.js';

// Pin Date.now around a callback so --version+time is deterministic.
function withEpoch(epochSeconds, fn) {
    const real = Date.now;
    Date.now = () => epochSeconds * 1000;
    try { return fn(); }
    finally { Date.now = real; }
}

test('computeNextVersion reproduces the full canary format (tag.time.name.hash)', () => {
    const v = withEpoch(1782551556, () => computeNextVersion('5.1.2', {
        useTagInVersion: true, tag: 'canary',
        useTimeInVersion: true, useNameInVersion: true, useHashInVersion: true,
        shortSha: '7c76e45',
    }));
    assert.equal(v, '5.1.2-canary.1782551556.isaac-newton.7c76e45');
});

test('no flags is a no-op (already-finalized version passes through unchanged)', () => {
    const finalized = '5.1.2-canary.1782551556.isaac-newton.7c76e45';
    assert.equal(computeNextVersion(finalized, {}), finalized);
    assert.equal(computeNextVersion('5.1.2', {}), '5.1.2');
});

test('tag "latest" is never appended to the version', () => {
    assert.equal(computeNextVersion('5.1.2', { useTagInVersion: true, tag: 'latest' }), '5.1.2');
});

test('useTagInVersion strips an existing prerelease before applying the new tag', () => {
    assert.equal(
        computeNextVersion('5.1.2-dev', { useTagInVersion: true, tag: 'canary' }),
        '5.1.2-canary',
    );
});

test('first segment uses "-", subsequent segments use "."', () => {
    // time on a clean version -> dash
    assert.equal(withEpoch(1700000000, () => computeNextVersion('1.0.0', { useTimeInVersion: true })), '1.0.0-1700000000');
    // hash alone on a clean version -> dash
    assert.equal(computeNextVersion('1.0.0', { useHashInVersion: true, shortSha: 'abc1234' }), '1.0.0-abc1234');
    // name after an existing prerelease -> dot
    assert.equal(
        computeNextVersion('1.0.0-canary', { useNameInVersion: true, shortSha: '7c76e45' }),
        '1.0.0-canary.isaac-newton',
    );
});

test('name/hash segments are skipped when shortSha is missing', () => {
    assert.equal(
        computeNextVersion('1.0.0', { useTagInVersion: true, tag: 'canary', useNameInVersion: true, useHashInVersion: true, shortSha: null }),
        '1.0.0-canary',
    );
});

test('getVersionName is deterministic for a given hash', () => {
    assert.equal(getVersionName('7c76e45'), 'isaac-newton');
    assert.equal(getVersionName('7c76e45'), getVersionName('7c76e45'));
});
