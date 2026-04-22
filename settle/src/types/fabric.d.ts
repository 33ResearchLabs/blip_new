// Module shim for fabric.js v5. fabric v5 does not ship its own type
// declarations, and `@types/fabric` is out of date / mismatched with
// v5's runtime shape. We only use fabric inside the IssueAnnotator
// where every call site is already typed `any`, so a bare module
// declaration is sufficient — it silences TS7016 without pulling in
// mismatched types.
declare module 'fabric';
