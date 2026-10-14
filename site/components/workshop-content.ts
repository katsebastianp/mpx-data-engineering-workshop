export type WorkshopExercise = {
  id: string;
  title: string;
  instruction: string;
  hint: string;
  prompt: string;
  checkpoint: string;
  extraPrompts?: { title: string; prompt: string }[];
  commands?: string;
  commandTitle?: string;
  dependsOn: string[];
  location: "local" | "pipeline" | "models" | "integration";
};

export type WorkshopPart = {
  id: string;
  number: string;
  label: string;
  title: string;
  time: string;
  description: string;
  exercises: WorkshopExercise[];
};

export const workshopParts: WorkshopPart[] = [
  {
    id: "intro",
    number: "00",
    label: "Setup",
    title: "Prepare your baseline",
    time: "00–25 min",
    description: "Understand the code, run the supplied pipeline, then open two worktrees from your own baseline",
    exercises: [
      {
        id: "project",
        dependsOn: [],
        location: "local",
        title: "Pull main and create your personal branch",
        instruction: "Open the facilitator’s repository in Codex, verify GitHub access, and create {{branch}} from current main. Download the four sample files below and place them in data/01_raw/ inside your checkout. Sophon will download automatically during setup.",
        hint: "ChatGPT sign-in does not authenticate GitHub. Your work stays on {{branch}} and its temporary worktree branches; shared main stays unchanged by the workshop exercises.",
        prompt: "- Use {{repositoryUrl}}. Verify GitHub read/write access and the intended remote; ask for the facilitator’s URL if missing.\n- Inspect Git status and branches. Preserve existing work. From clean, up-to-date origin/main, create or safely resume my personal branch {{branch}}; leave shared main unchanged.\n- Ask where I saved the four Site downloads: train.parquet, validation.parquet, test.parquet and manifest.json. Copy them unchanged into data/01_raw/; verify against config/workshop-sample.lock.json and stop on conflicts. If missing, direct me to the Site download links. No ZIP or Site login token is needed.\n- In config/experiments.yaml, set team: {{participantId}}. Keep evaluation: validation, seed: 42, max_workers: 1, and the default experiments.\n- Show the checkout path, branch, starting commit, input checks and setup diff. Do not commit unrelated work.",
        checkpoint: "{{branch}} starts from verified main, GitHub access works, and experiment metadata uses {{participantId}}",
        commands: "gh auth status\ngit status --short\ngit remote -v\n# After Codex verifies origin/main and confirms this is the intended clean checkout\nif test -z \"$(git status --porcelain)\"; then\n  git fetch origin &&\n  git switch main &&\n  git pull --ff-only origin main &&\n  git switch -c '{{branch}}'\nelse\n  printf '%s\\n' 'Uncommitted work found — stop and preserve it before continuing'\nfi\n# If your personal branch already exists, ask Codex to inspect and resume it safely",
      },
      {
        id: "overview",
        dependsOn: ["project"],
        location: "local",
        title: "Ask Codex to map the code and data flow",
        instruction: "Have Codex write docs/workshop-overview.md with a data-flow diagram and a brief guide to the code and folders. Read it before running the pipeline.",
        hint: "Ask which files read, transform, train, and export the data. Prepared inputs, model artifacts, predictions, and final submissions serve different purposes.",
        prompt: "- Inspect README.md, compose.yaml, config/experiments.yaml, and the code in src/.\n- Create docs/workshop-overview.md on {{branch}}: a small Mermaid data-flow diagram and a table of code/data responsibilities.\n- Explain raw → prepared → predictions/models → DuckDB/comparison JSON → submission. Show Sophon as a frozen reference.\n- Explain train/validation/test roles and tracked source versus ignored data. Document code and data only; workshop steps live on the Site.\n- Show the document diff, then commit only this overview. Do not run workloads or inspect test performance.",
        checkpoint: "docs/workshop-overview.md is reviewed and committed, with a grounded diagram, folder guide, and explicit unknowns",
        commands: "git branch --show-current\ngit status --short -- docs/workshop-overview.md\ngit log -1 --oneline -- docs/workshop-overview.md",
      },
      {
        id: "smoke",
        dependsOn: ["overview"],
        location: "local",
        title: "Build once and freeze the baseline",
        instruction: "Start Docker Desktop or Colima with Linux containers and Docker Compose. Build the shared lab image and run setup to verify the sample and download Sophon. Then run the tests and default validation flow, preserving the prepared data and baseline results.",
        hint: "The container uses 2 CPUs and 2 GiB. Both worktrees reuse this image with their own mounted source and outputs. Only dependency or Dockerfile changes need a rebuild; these exercises keep both fixed.",
        prompt: "- On {{branch}}, check team: {{participantId}}, validation evaluation, seed: 42 and max_workers: 1.\n- Build the Compose lab image once. Run the setup service to verify the four sample files and download the pinned Sophon model. No Hugging Face account or token is needed; internet access is required for this step. Stop on failed checks.\n- Using project {{composePrefix}}-setup, run tests, preprocessing, predict and postprocessing in the offline lab service.\n- Confirm 4,000 / 1,000 / 1,000 train/validation/test rows and 4,000 validation predictions across four default experiments.\n- Preserve prepared inputs, checksums, timings and comparison.json in a new evidence/ snapshot. Record the source commit and setup diff.\n- Keep data and model outputs out of commits. Resolve failures before opening worktrees.",
        commands: "docker compose version\ndocker compose -p {{composePrefix}}-setup build lab\ndocker compose -p {{composePrefix}}-setup run --rm --no-deps setup\ndocker compose -p {{composePrefix}}-setup run --rm --no-deps lab -m pytest -q\ndocker compose -p {{composePrefix}}-setup run --rm --no-deps lab -m preprocessing\ndocker compose -p {{composePrefix}}-setup run --rm --no-deps lab -m predict\ndocker compose -p {{composePrefix}}-setup run --rm --no-deps lab -m postprocessing",
        checkpoint: "Sample and Sophon checksums pass, tests pass, and the original prepared data, timings, and comparison export are preserved",
      },
      {
        id: "worktrees",
        dependsOn: ["smoke"],
        location: "local",
        title: "Open two Codex worktrees",
        instruction: "Open two new Codex chats using Worktree, both from the same frozen commit on {{branch}}. Name the temporary branches {{pipelineBranch}} and {{modelsBranch}}. Keep your original checkout on {{branch}} for the final merge.",
        hint: "Both chats can work at the same time. On an 8-GB laptop, take turns running Spark and training while the other chat codes or reviews. Larger machines can explore concurrently, but timings need a separate quiet run before comparison.",
        prompt: "- On {{branch}}, verify the overview, participant metadata and supplied .worktreeinclude. Commit only the intended setup files.\n- Record the frozen commit and original checkout path. Keep this checkout for integration.\n- Guide me to open two Worktree chats from this same commit: {{pipelineBranch}} and {{modelsBranch}}. I will paste the lane prompts below into the new chats.\n- After creation, verify distinct paths and matching input checksums. If automatic copying is unavailable, copy only the listed input folders explicitly; never share writable data/model directories.\n- Reuse particle-workshop:0.6.0. I will coordinate one heavy Docker job at a time; chats can code and review in parallel.",
        commandTitle: "Show .worktreeinclude contents",
        commands: "# .worktreeinclude — create before opening the worktrees\ndata/01_raw/**\ndata/02_preprocessed/**\nmodels/pretrained/sophon/**",
        extraPrompts: [
          { title: "Copy into Worktree A · pipeline", prompt: "- Create or verify branch {{pipelineBranch}} from the frozen {{branch}} commit.\n- Read docs/workshop-overview.md and confirm copied input checksums against the original checkout. Ask for its path and frozen SHA if missing.\n- Own preprocessing code and its tests; keep features and model configuration unchanged.\n- Use Compose project {{composePrefix}}-pipeline and the existing image. Outputs stay here.\n- Wait for my compute slot before Docker jobs. Tell me when this chat is ready for the profile step on the Site." },
          { title: "Copy into Worktree B · models", prompt: "- Create or verify branch {{modelsBranch}} from the same frozen {{branch}} commit.\n- Read docs/workshop-overview.md and confirm copied input checksums against the original checkout. Ask for its path and frozen SHA if missing.\n- Own config/experiments.yaml and experiment notes; keep preprocessing unchanged.\n- Use Compose project {{composePrefix}}-models and the existing image. Keep team: {{participantId}}, validation evaluation and max_workers: 1.\n- Wait for my compute slot before Docker jobs. Tell me when this chat is ready for the experiment step on the Site." },
        ],
        checkpoint: "Two named worktrees share the same starting commit and verified input snapshot, with separate output directories",
      },
    ],
  },
  {
    id: "pipeline",
    number: "01",
    label: "Optimise the pipeline",
    title: "Pipeline optimisation",
    time: "25–65 min · parallel",
    description: "Worktree A · Improve preprocessing while the second chat compares models on the frozen data",
    exercises: [
      {
        id: "profile",
        dependsOn: ["worktrees"],
        location: "pipeline",
        title: "Measure the baseline",
        instruction: "In {{pipelineBranch}}, preserve the copied prepared data and profile preprocessing. Start timing only when the model worktree has no heavy job running.",
        hint: "Look at particle_features() in src/preprocessing/features.py and the Spark execution plan. The particle-pair calculation contains a nested Python loop. Check the measurements before deciding what to change.",
        prompt: "- Work in {{pipelineBranch}} with Compose project {{composePrefix}}-pipeline.\n- Preserve data/02_preprocessed/ and its checksums in data/02_preprocessed_baseline/ before running preprocessing; do not overwrite an existing baseline.\n- Profile src/preprocessing/pipeline.py and features.py with unchanged data and resource limits.\n- On a quiet machine, repeat measurements: elapsed time, jets_per_second, Spark jobs/stages/tasks.\n- Propose one focused optimization and a testable hypothesis. Report the baseline before claiming a speedup.",
        checkpoint: "A preserved baseline, repeat measurements on an idle machine, and one bottleneck hypothesis",
      },
      {
        id: "optimise",
        dependsOn: ["profile"],
        location: "pipeline",
        title: "Improve latency without changing the answer",
        instruction: "Implement the most promising change. Compare records and features against the baseline before interpreting the timings.",
        hint: "Match rows by record_id. Numerical features use rtol=1e-7 and atol=1e-9. Flags and complete particle arrays must match exactly. Keep the dataset and hardware limits fixed.",
        prompt: "- In {{pipelineBranch}}, implement one preprocessing optimization; preserve logging and error handling.\n- Keep feature definitions, splits, IDs, particle arrays and resource limits unchanged. Leave model configuration to the other chat.\n- Compare against the baseline by record_id: numerical features rtol=1e-7, atol=1e-9; exact flags and complete particle arrays.\n- Run relevant tests and repeat quiet-machine timings with Compose project {{composePrefix}}-pipeline.\n- Report median, spread, throughput and speedup (or no improvement). Keep the change only if outputs remain equivalent.",
        checkpoint: "Equivalent outputs and a measured before/after comparison, with unchanged feature definitions",
      },
      {
        id: "pr-review",
        dependsOn: ["optimise"],
        location: "pipeline",
        title: "Run /review and create the pipeline PR",
        instruction: "In the pipeline chat, type /review and review the branch changes against {{branch}}. Then use the prompt below to fix findings and have Codex create the PR.",
        hint: "Select the branch comparison, not just uncommitted changes. After fixes, review the latest diff again. /review is a Codex command, not a terminal command or a GitHub review comment. If your app does not expose it, use Codex CLI /review or the available code-review control with the same scope.",
        prompt: "- Check the /review findings for {{pipelineBranch}} against {{branch}}. Address actionable issues and rerun affected checks; review the final diff again after fixes.\n- Commit only the pipeline code, tests and concise benchmark evidence. Exclude data, models and unrelated changes.\n- Prepare a PR with base {{branch}} and head {{pipelineBranch}}. Include the hypothesis, equivalence checks, timing results and limitations.\n- Show the exact diff, repository, base/head and PR text for my approval. Then push the necessary personal branches and create the PR with Codex.\n- Leave the PR open for integration. Record its URL, reviewed head SHA and evidence paths; do not target main.",
        commandTitle: "Show PR command after reviewing and approving the diff",
        commands: "# Run only after the intended remote/repository, pushed branches, and PR content are verified and approved\ngh repo view --json nameWithOwner,url\ngh pr create --base '{{branch}}' --head '{{pipelineBranch}}'",
        checkpoint: "Pipeline /review findings are resolved, and Codex has created the approved PR into your personal branch",
      },
    ],
  },
  {
    id: "models",
    number: "02",
    label: "Train & compare",
    title: "Model training and comparison",
    time: "25–65 min · parallel",
    description: "Worktree B · Compare classifiers on frozen prepared data while the first chat improves preprocessing",
    exercises: [
      {
        id: "experiments",
        dependsOn: ["worktrees"],
        location: "models",
        title: "Design your experiment matrix",
        instruction: "In {{modelsBranch}}, explore logistic regression and XGBoost on your private copy of the frozen prepared data. Give each variant a hypothesis and a unique experiment ID.",
        hint: "basic uses three features; shape uses all eight. You can supply a subset of measured feature names. Tune C for logistic regression, or tree depth, count, learning rate, and regularization for XGBoost. Adding another classifier family requires extending the runner and submission contract.",
        prompt: "- In {{modelsBranch}}, verify prepared-data checksums against the frozen baseline.\n- Propose 2–4 deliberate logistic/XGBoost variants in config/experiments.yaml. Give each a unique ID, hypothesis and explanation.\n- Vary supported parameters and basic, shape or subsets of the eight measured features. Keep Sophon separate as a frozen reference.\n- Keep team: {{participantId}}, evaluation: validation, seed: 42 and max_workers: 1. Fit on train only.\n- Do not change preprocessing, use truth/IDs as inputs, or inspect test performance. Show the experiment matrix before running it.",
        checkpoint: "A small experiment matrix on the frozen inputs, with test evaluation still off",
      },
      {
        id: "train",
        dependsOn: ["experiments"],
        location: "models",
        title: "Run the models and inspect the outputs",
        instruction: "Train the variants and compare validation quality against inference time. On an 8-GB laptop, coordinate your compute slot with the pipeline chat, then inspect disagreements while it runs its next experiment.",
        hint: "postprocessing builds a real DuckDB database and a browser export. Use the complete validation population for metrics. Scores are signal-like discriminants, not calibrated probabilities.",
        prompt: "- In {{modelsBranch}}, run predict and postprocessing with Compose project {{composePrefix}}-models and max_workers: 1.\n- Wait for my compute slot; no pipeline or other heavy job should overlap training or timing.\n- Use analytics.duckdb and comparison.json to compare validation ROC-AUC, average precision, errors at 0.5, training time and normalized inference time.\n- Explain model disagreements and quality–speed trade-offs from complete validation populations. Keep Sophon separate; leave test results unseen.\n- Preserve an immutable evidence/ snapshot of the config and exports, recording paths, checksums and source commit for integration or a read-only analysis chat.",
        commands: "docker compose -p {{composePrefix}}-models run --rm --no-deps lab -m predict\ndocker compose -p {{composePrefix}}-models run --rm --no-deps lab -m postprocessing",
        extraPrompts: [
          { title: "Optional · copy into a read-only analysis chat", prompt: "- Ask me for the absolute path of the immutable model evidence snapshot. Read its config and comparison.json; do not assume another chat’s context is available.\n- Compare validation quality, inference cost and disagreements across the trained models. Keep Sophon separate.\n- Recommend one choice and explain a limitation using saved values only.\n- Do not edit files, run training, write to DuckDB or inspect test performance. Return the analysis in chat so I can bring it back to the model chat." },
        ],
        checkpoint: "Saved validation results explain model quality, disagreements, and inference cost",
      },
      {
        id: "select",
        dependsOn: ["train"],
        location: "models",
        title: "Select, review and create the model PR",
        instruction: "Choose on validation, run /review against {{branch}}, and have Codex create a model PR into your personal branch. Use the prompt below in two passes: freeze the choice, then review and publish.",
        hint: "Quality and efficiency are separate awards. Efficiency requires a final test AUC within 0.02 of the best trained result. You do not know that result yet: choose from your validation evidence.",
        prompt: "- In {{modelsBranch}}, select one trained model using validation only. Explain its quality, inference cost and limitations.\n- Preserve the experiment matrix and comparison snapshot. Retain the chosen experiment in config/experiments.yaml with team: {{participantId}} and evaluation: validation.\n- Record its features, parameters, seed, metrics and evidence paths. Freeze this choice before the final test.\n- Pause for me to run /review on this branch against {{branch}}. Resolve findings and repeat the review after fixes.\n- Commit only the chosen configuration and concise experiment notes. Show a PR from {{modelsBranch}} into {{branch}} for approval, then have Codex create it. Record its URL and reviewed head SHA; leave it open for integration.",
        checkpoint: "One frozen model choice, a resolved /review and a model PR ready for integration",
      },
    ],
  },
  {
    id: "integration",
    number: "03",
    label: "Merge back to your branch",
    title: "Bring both changes back to your branch",
    time: "65–85 min",
    description: "Return to your personal branch, merge both temporary branches, and verify the combined result",
    exercises: [
      {
        id: "integrate",
        dependsOn: ["pr-review", "select"],
        location: "integration",
        title: "Merge both changes into your personal branch",
        instruction: "Return to the original checkout on {{branch}}. Have Codex merge both reviewed PRs into this personal branch, then update the local checkout.",
        hint: "Do not create another integration branch or check out the same personal branch in a second worktree. Git merges code; saved experiment outputs need a separate, explicit handoff.",
        prompt: "- Return to the original checkout on {{branch}}. Verify a clean tracked state and both reviewed PRs, including their latest head SHAs.\n- With my approval, merge both PRs into {{branch}}, then fast-forward the local personal branch. If a PR already merged, verify its changes rather than replaying it. Never merge into main.\n- Check that both the pipeline improvement and frozen model choice are present. Keep team: {{participantId}} and evaluation: validation.\n- Preserve existing prediction, submission, analytics and generated model outputs together under evidence/, keeping their relative paths. Start fresh output folders; retain raw inputs, prepared baseline and models/pretrained/sophon/.\n- Copy the model comparison and pipeline measurements into separately labelled evidence folders with checksums; Git merges do not carry ignored outputs.\n- Run relevant tests with Compose project {{composePrefix}}-integration. Keep both worktrees until combined validation passes.",
        commandTitle: "Show branch checks before the merge",
        commands: "# In the original checkout on your personal branch\ngit branch --show-current\ngit status --short\ngit worktree list\ngit log --oneline --left-right '{{branch}}...{{pipelineBranch}}'\ngit log --oneline --left-right '{{branch}}...{{modelsBranch}}'\n# Ask Codex to inspect PR merge state/equivalence before merging either change again",
        checkpoint: "{{branch}} contains both reviewed changes; tests pass and previous outputs are preserved separately",
      },
      {
        id: "preprocess",
        dependsOn: ["integrate"],
        location: "integration",
        title: "Verify the combined pipeline and model",
        instruction: "Regenerate all three splits with the merged preprocessing code, check equivalence, then rerun the frozen model on validation. Continue only when the combined result is sound.",
        hint: "Prepared data records a hash of features.py. Editing that file changes its hash even if feature values stay equivalent, so regenerate the manifest from the merged source. Never edit the hash to bypass the checks.",
        prompt: "- On {{branch}}, confirm fresh output folders, preserved evidence and the frozen model configuration for {{participantId}}.\n- Rerun preprocessing with project {{composePrefix}}-integration: features.py edits require a new source-hashed manifest.\n- Check 4,000 / 1,000 / 1,000 rows, disjoint IDs and manifest hashes. Compare prepared values to baseline by record_id (rtol=1e-7, atol=1e-9); flags and particle arrays must match exactly.\n- If equivalence passes, run the selected model and postprocessing on validation, with other heavy jobs stopped.\n- Compare predictions and metrics to the saved model evidence and explain differences. Do not bypass manifests or retune to hide an integration failure.",
        commands: "docker compose -p {{composePrefix}}-integration run --rm --no-deps lab -m preprocessing\n# Check equivalence before proceeding\ndocker compose -p {{composePrefix}}-integration run --rm --no-deps lab -m predict\ndocker compose -p {{composePrefix}}-integration run --rm --no-deps lab -m postprocessing",
        checkpoint: "Merged preprocessing is equivalent and the frozen model passes a fresh validation run with quiet timing",
      },
    ],
  },
  {
    id: "site",
    number: "04",
    label: "Build your results Site",
    title: "Build a results Site",
    time: "85–105 min",
    description: "Use the Sites plugin to present your experiments, model choice, and results",
    exercises: [
      {
        id: "results-site",
        dependsOn: ["preprocess"],
        location: "integration",
        title: "Create your results Site",
        instruction: "Build a results Site from the preserved model comparison and verified integration results. Show what each worktree changed, what you chose, and where the model fails.",
        hint: "A useful Site includes a quality–latency chart, model disagreements, and a threshold control using every evaluation row. Label Δη and Δφ as angular offsets. Mark the final test as pending until you have run it.",
        prompt: "- Use the Sites plugin to present my results for {{participantId}} from {{branch}}.\n- Use the preserved model comparison, pipeline benchmarks and fresh integration export. Label each source/commit separately; final test is still pending.\n- Show quality versus latency, model disagreements and a threshold control over the complete evaluation population.\n- Explain each worktree’s contribution, my selected model and failure cases. Separate Sophon from trained entries.\n- Label Δη/Δφ as angular offsets and energy in GeV; distinguish measured inputs from simulation truth. Use real saved values and verify audience access before sharing.\n- If Sites is unavailable, use tools/results-preview/index.html and its “Preview a results file” control to open comparison.json locally.",
        checkpoint: "A working Site presents both branches and their verified combination, with final test clearly pending",
      },
    ],
  },
  {
    id: "submit",
    number: "05",
    label: "Test & submit",
    title: "Final test and submission",
    time: "105–120 min",
    description: "Run the final test, upload your results, and prepare a short presentation",
    exercises: [
      {
        id: "final-test",
        dependsOn: ["results-site"],
        location: "integration",
        title: "Run the final test once",
        instruction: "Keep exactly one selected trained experiment, switch evaluation to test, and run predict followed by postprocessing. Preserve that result.",
        hint: "predict refits the selected configuration from train with the fixed seed, then scores validation and test (2,000 rows). It does not reuse the prior fitted model. Preserve the final artifact and do not tune again.",
        prompt: "- On {{branch}}, confirm combined validation passed and retain exactly the model selected on validation.\n- Keep features, parameters, seed, explanation and team: {{participantId}} fixed; set evaluation: test.\n- If this final configuration already has a completed test run, reuse it. Otherwise run predict then postprocessing once, with project {{composePrefix}}-integration and no competing heavy jobs.\n- Preserve the result and identify its exact data/04_submissions/ JSON. Verify complete validation/test IDs and participant metadata.\n- Explain that predict refits from train with the fixed seed before scoring; preserve the final model artifact. Do not tune from test results.\n- Update my results Site with a separate final-test section.",
        commands: "docker compose -p {{composePrefix}}-integration run --rm --no-deps lab -m predict\ndocker compose -p {{composePrefix}}-integration run --rm --no-deps lab -m postprocessing",
        checkpoint: "One preserved final result with complete validation/test predictions and its generated submission JSON",
      },
      {
        id: "upload",
        dependsOn: ["final-test"],
        location: "integration",
        title: "Upload and compare results",
        instruction: "Open the leaderboard and upload your final submission JSON. Check the receipt and your result, then prepare a one-minute explanation.",
        hint: "Upload only the generated JSON, up to 1 MB. Do not upload models, raw data, or code. The server checks the fixed dataset and IDs and recomputes quality. Scores and timings remain participant-reported.",
        prompt: "- Review the final JSON for {{participantId}}: dataset identity, final selection, complete IDs, finite scores and fixed timing protocol.\n- Validate it against config/evaluation.json with the trusted postprocessing.leaderboard collector; do not alter reported values.\n- Show the exact generated file (under 1 MB). I will upload it using the workshop leaderboard.\n- Prepare a one-minute explanation: preprocessing improvement, model choice, final result and one limitation.",
        checkpoint: "Your result is accepted by the leaderboard and you can explain the evidence in one minute",
      },
    ],
  },
];

export const workshopExercises = workshopParts.flatMap((part) => part.exercises);
