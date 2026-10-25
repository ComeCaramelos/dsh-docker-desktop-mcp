/**
 * Host-side tests for the two named catalogs and the executable discovery that
 * feeds one of them.
 *
 * The catalog helpers are pure, so they are exercised against the same fixtures
 * `test/client.test.mjs` pins the browser mirror against — a drift between the
 * two halves fails here first. Executable discovery is fs-only (never a spawn),
 * so it is deterministic against a stubbed `exists`.
 */
import * as assert from "node:assert/strict";
import { discoverExecutables, entryIds, entryLabel, isValidEntryId, mergeEntries, normalizeEntries } from "../lib/index.js";

// ── row validation ────────────────────────────────────────────────────────
assert.equal(isValidEntryId("profiles", "alpha"), true, "a plain profile id validates");
assert.equal(isValidEntryId("profiles", "alpha 1"), false, "a profile id with a space cannot go on the wire");
assert.equal(isValidEntryId("profiles", ""), false, "an empty id is never a row");
assert.equal(isValidEntryId("profiles", undefined), false, "a missing id is not a row either");
assert.equal(isValidEntryId("executables", "/usr/bin/docker"), true, "an absolute path is an executable id");
assert.equal(isValidEntryId("executables", "docker"), true, "a bare name is an executable id");
assert.equal(isValidEntryId("executables", "bad\npath"), false, "control characters never validate");
assert.equal(isValidEntryId("executables", "x".repeat(1025)), false, "an oversized id is rejected");
assert.equal(isValidEntryId("executables", ".smoke/fake-docker"), false, "a checkout-local smoke fixture is never an executable row");
assert.equal(
    isValidEntryId("executables", "/home/user/repo/.smoke/noise-docker"),
    false,
    "the absolute smoke path is rejected too"
);
assert.equal(isValidEntryId("executables", "C:\\repo\\.smoke\\fake-docker"), false, "a Windows-style smoke path is rejected");
assert.equal(isValidEntryId("executables", "/usr/bin/docker-smoke"), true, "a real path merely mentioning smoke is not a fixture");

// ── normalization ─────────────────────────────────────────────────────────
{
    const rows = normalizeEntries(
        [
            { id: "  alpha  ", name: "  Alpha  " },
            { id: "bad id", name: "Dropped" },
            { id: "alpha", name: "Dup" },
            { id: "beta" },
            "nonsense",
            null,
            [],
            { id: 1, name: 2 }
        ],
        "profiles"
    );
    assert.equal(
        JSON.stringify(rows),
        JSON.stringify([
            { id: "alpha", name: "Alpha" },
            { id: "beta", name: "" }
        ]),
        "ids and names are trimmed, unusable and duplicate ids drop, missing names read empty"
    );
    assert.equal(JSON.stringify(normalizeEntries(void 0, "profiles")), "[]", "anything that is not an array is no rows");
    assert.equal(JSON.stringify(normalizeEntries([], "executables")), "[]", "an empty catalog is well-formed");
    const long = normalizeEntries([{ id: "x", name: "y".repeat(400) }], "executables")[0];
    assert.equal(long.name.length, 200, "a name is capped, never a throw");
    assert.equal(entryLabel(rows[0]), "Alpha", "a named row labels by its name");
    assert.equal(entryLabel(rows[1]), "beta", "an unnamed row labels by its id");
    assert.deepEqual(entryIds(rows), ["alpha", "beta"], "ids come out in row order");
    assert.deepEqual(entryIds(void 0), [], "a missing catalog reads as no ids");
}

// ── merging recovered ids into saved rows ─────────────────────────────────
{
    const stored = [
        { id: "alpha", name: "Alpha" },
        { id: "beta", name: "" }
    ];
    const first = mergeEntries(stored, ["beta", "gamma"], "profiles");
    assert.equal(first.changed, true, "a new recovered id changes the catalog");
    assert.equal(
        JSON.stringify(first.entries),
        JSON.stringify([
            { id: "alpha", name: "Alpha" },
            { id: "beta", name: "" },
            { id: "gamma", name: "" }
        ]),
        "saved rows keep order and names; an unlisted id is appended nameless"
    );
    const second = mergeEntries(first.entries, ["alpha", "beta", "gamma"], "profiles");
    assert.equal(second.changed, false, "re-merging the same ids is a no-op write");
    const third = mergeEntries(first.entries, ["delta", "alpha"], "profiles");
    assert.equal(
        JSON.stringify(third.entries),
        JSON.stringify([
            { id: "alpha", name: "Alpha" },
            { id: "beta", name: "" },
            { id: "gamma", name: "" },
            { id: "delta", name: "" }
        ]),
        "new ids land at the end, existing ids never move or rename"
    );
    // A row the user deleted only returns when the source still reports the id.
    const pruned = mergeEntries([{ id: "beta", name: "" }], [], "profiles");
    assert.equal(pruned.changed, false, "nothing recovered leaves the rows alone");
    const revived = mergeEntries([], ["alpha"], "profiles");
    assert.equal(revived.changed, true, "a recovery with nothing stored still records the id");
    assert.equal(
        JSON.stringify(revived.entries),
        JSON.stringify([{ id: "alpha", name: "" }]),
        "recovered ids land as nameless rows"
    );
    const junk = mergeEntries("nope", ["alpha", "bad id"], "profiles");
    assert.equal(
        JSON.stringify(junk.entries),
        JSON.stringify([{ id: "alpha", name: "" }]),
        "an unusable stored value and id never become rows"
    );
    const paths = mergeEntries([{ id: "/usr/bin/docker", name: "Local" }], ["/usr/local/bin/docker", "/usr/bin/docker"], "executables");
    assert.equal(
        JSON.stringify(paths.entries),
        JSON.stringify([
            { id: "/usr/bin/docker", name: "Local" },
            { id: "/usr/local/bin/docker", name: "" }
        ]),
        "executable rows follow the same merge rule"
    );
    // Smoke fixtures never enter the executable catalog: not through the merge
    // (the headless /docker-refresh path), not as already-saved rows.
    const refreshed = mergeEntries([], ["/usr/bin/docker", ".smoke/fake-docker"], "executables");
    assert.equal(
        JSON.stringify(refreshed.entries),
        JSON.stringify([{ id: "/usr/bin/docker", name: "" }]),
        "a discovered smoke fixture is never merged in"
    );
    const dropped = normalizeEntries([{ id: ".smoke/noise-docker", name: "Noise" }], "executables");
    assert.equal(JSON.stringify(dropped), "[]", "a saved smoke-fixture row is dropped by normalization");
}

// ── executable discovery (fs-only, stubbed existence) ─────────────────────
{
    const present = new Set(["/Docker/host/bin/docker.exe", "/usr/bin/docker", "/usr/bin/docker-compose"]);
    const seen = [];
    const found = discoverExecutables({
        platform: "linux",
        env: { PATH: "/usr/bin:/usr/local/bin:/snap/bin" },
        exists: (candidate) => {
            seen.push(candidate);
            return present.has(candidate);
        }
    });
    assert.equal(
        JSON.stringify(found),
        JSON.stringify(["/Docker/host/bin/docker.exe", "/usr/bin/docker", "/usr/bin/docker-compose"]),
        "existing candidates come back in precedence order, without duplicates"
    );
    assert.equal(new Set(found).size, found.length, "the result is de-duplicated");
    assert.equal(seen.indexOf("/Docker/host/bin/docker.exe") < seen.indexOf("/usr/bin/docker"), true, "the WSL host CLI is probed first");
    assert.equal(found.includes("/snap/bin/docker"), false, "a candidate that is not executable never becomes a row");
}
{
    // The PATH probe stays bounded: one hit per name, not one row per directory.
    const env = { PATH: "/a:/b:/c" };
    const hits = [];
    const found = discoverExecutables({
        platform: "linux",
        env,
        exists: (candidate) => {
            hits.push(candidate);
            return candidate.endsWith("docker") ? candidate === "/a/docker" : false;
        }
    });
    assert.equal(found.includes("/a/docker"), true, "the first PATH hit per name is enough");
    assert.equal(found.includes("/b/docker"), false, "the same name is never listed twice");
    // Only the first PATH directory is walked per name: /b and /c are never
    // probed for the same name, so a refresh stays a handful of rows.
    for (const dir of ["/b", "/c"]) {
        assert.equal(hits.includes(dir + "/docker"), false, "PATH directories after the first are not walked: " + dir);
    }
}
{
    const found = discoverExecutables({ platform: "linux", env: { PATH: "" }, exists: () => false });
    assert.deepEqual(found, [], "nothing present is an empty catalog, not a failure");
}
{
    // Windows-style PATH entries never reach a linux probe.
    const found = discoverExecutables({
        platform: "linux",
        env: { PATH: "/usr\\local\\bin:/usr/bin" },
        exists: (candidate) => candidate === "/usr/bin/docker"
    });
    assert.deepEqual(found, ["/usr/bin/docker"], "a Windows-style PATH entry is skipped on linux");
}
{
    // A `.smoke` directory that happens to be reachable is never a candidate —
    // it is not even probed, so a smoke fixture can never reach the dialog.
    const probed = [];
    const found = discoverExecutables({
        platform: "linux",
        env: { PATH: "/home/user/repo/.smoke:/usr/bin" },
        exists: (candidate) => {
            probed.push(candidate);
            // Make only the smoke paths "executable" — without the rule the
            // shim paths would land in the candidate list.
            return candidate.includes("/.smoke/");
        }
    });
    assert.equal(JSON.stringify(found), "[]", "every candidate the probe claims exists is either an absent absolute path or a smoke fixture");
    assert.equal(probed.some((candidate) => candidate.includes("/.smoke/")), false, "a smoke fixture path is never probed");
}

console.log("catalog.test.mjs: all assertions passed");
