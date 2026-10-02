# Customer feature review screenshots

See the [evidence gallery](evidence/README.md) for genuine before/after screenshots and precise source/runtime limits. The screenshots support the ordered customer feature PRs; the shared delivery also contains final history compatibility and authenticated-session test-fixture repairs. Source feature ranges and the original main branch are preserved.

The first session PR uses a separately verified publication head based on its original feature commit plus the four authenticated-session fixture repairs. Merge it first, then retarget each dependent PR to upstream main in the recorded order. Merge commits preserve the ancestry; squash merging requires rebasing dependent heads. The shared delivery includes the equivalent fixture patch, which merges to the same final tree.
