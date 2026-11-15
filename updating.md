# Maintenance Guide: Updating Proto Definitions

This guide is for coding agents tasked with updating and maintaining the Chromium `AnnotatedPageContent` protobuf definitions for `chromium-clean-markdown`.

We regularly pull the latest `common_quality_data.proto` from the Chromium source tree to stay in sync with upstream `AIPageContentAgent` / Optimization Guide changes and find new opportunities for higher-fidelity Markdown conversion.

---

## Step 1: Run the Update Script

To fetch the latest proto file and compile it, run the following command from the repository root:

```bash
node src/update-proto.ts
```

---

## Step 2: Investigate Changes in the Proto

After running the script, use Git to inspect what changed in the proto file itself:

```bash
git diff src/proto/common_quality_data.proto
```

Scan the diff for the following:

### A. Breaking Changes
* **What to look for:** Renamed fields, deleted fields (often marked as `reserved`), or changed types.
* **Action:** Search the codebase (`src/decode_annotations.ts` and `src/index.ts`) to see if we access those modified/deleted fields. If we do, update our parsing logic to preserve compatibility.

### B. Opportunities for Higher-Fidelity Markdown
* **What to look for:**
  * New attributes added to `ContentAttributeType` (e.g. dialogs, lists, tables).
  * New roles added to `AnnotatedRole` (e.g. structural layout markers).
  * New layout properties in `Geometry` or styling properties in `TextStyle`.
* **Action:** Evaluate if these can be used to improve the output Markdown quality (e.g., filtering out layout noise like cookie modals, extracting real image/media URLs, styling headings, or improving list structure).

---

## Step 3: Run the Test Suite

Always verify that the generated code compiles and passes our test suite:

```bash
pnpm run preflight
```

*(Integration tests launch Chromium via Playwright to test real CDP interactions.)*

---

## Step 4: Implement Improvements (If applicable)

If you identify opportunities in Step 2:
1. Update `src/decode_annotations.ts` to use the new proto fields/enums.
2. Add new test cases or mock fixtures in `test/` to cover the new features.
3. Verify `pnpm run preflight` passes.

---

## Step 5: Amend the Commit

Once verified, stage all changes and amend the current task commit to keep the Git history clean:

```bash
git add src/proto/ src/update-proto.ts updating.md
# Stage any other modified implementation/test files specifically
git commit --amend --no-edit
```
