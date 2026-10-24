# Strata

Strata is a system change review tool. Its core object is a **Change**: one feature, which may span many PRs and lives on past merge. Instead of reviewing a diff file by file, Strata classifies hunks into architectural layers, separates mechanical edits from meaningful ones, shows the before/after data model, and checks the change against its stated intent, with every claim linked back to evidence. The result should be the same no matter how the feature was split into PRs.

## Status

Planning milestone 1: a read-only spike that takes a PR, stack, or commit range and produces a single review page (verdict, summary, evidence, raw diff).
