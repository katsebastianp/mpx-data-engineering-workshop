export type WorkshopExercise = {
  id: string;
  title: string;
  instruction: string;
  actions?: string[];
  hint?: string;
  prompt?: string;
  decision?: string;
  concept?: { title: string; body: string };
  context?: { title: string; body: string }[];
  time?: string;
  optional?: boolean;
  checkpoint?: string;
  download?: { label: string; href: string };
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

export const WORKSHOP_REPOSITORY_URL = "https://github.com/RingierIMU/mpx-data-engineering-workshop";
export const WORKSHOP_SOURCE_BRANCH = "codex/workshop-readiness-20261019";
export const SOPHON_PAPER_URL = "https://arxiv.org/abs/2405.12972";
export const WORKSHOP_SOURCE_URL = `${WORKSHOP_REPOSITORY_URL}/tree/${WORKSHOP_SOURCE_BRANCH}`;

export const workshopParts: WorkshopPart[] = [
  {
    id: "intro",
    number: "00",
    label: "Setup & understand",
    title: "Prepare the project",
    time: "00–30 min · image built beforehand",
    description: "Get the code, follow one example, and run the baseline.",
    exercises: [
      {
        id: "codex-project",
        dependsOn: [],
        location: "local",
        title: "Create your Codex project",
        time: "3 min",
        instruction: "Open your prepared workshop folder in Codex. Starting fresh? Create an empty folder called machine-learning-lhc-workshop and open it as your project.",
        actions: [
          "Start a chat in that project and use the prompt below.",
          "Reuse the prepared checkout. Clone only if the selected folder is empty; the project folder must be the Git repository root for worktrees.",
        ],
        prompt: `Use the GitHub plugin to check access to ${WORKSHOP_REPOSITORY_URL}. In this Codex project's empty folder, clone its ${WORKSHOP_SOURCE_BRANCH} branch directly into . (the current folder), without creating a subfolder. If this folder is already the repository root, verify the remote and reuse it. If it is nonempty and not the repository root, stop and explain; preserve all files. Show the terminal command as a fallback. Confirm git rev-parse --show-toplevel matches the Codex project folder, and README.md, compose.yaml and src/ are directly inside it.`,
        commandTitle: "Terminal fallback · run in the empty project folder",
        commands: `gh auth status\ngh repo clone ${WORKSHOP_REPOSITORY_URL} . -- -b ${WORKSHOP_SOURCE_BRANCH}\n# If GitHub CLI is unavailable and Git access is already configured:\n# git clone -b ${WORKSHOP_SOURCE_BRANCH} ${WORKSHOP_REPOSITORY_URL}.git .`,
        checkpoint: "The Codex project folder is the Git repository root, with README.md directly inside it.",
      },
      {
        id: "download-data",
        dependsOn: ["codex-project"],
        location: "local",
        title: "Download the workshop data",
        time: "2 min",
        instruction: "Confirm the four files you checked before arrival. Download them now only if they are missing, then tell Codex where you saved them.",
        prompt: "The four workshop downloads are in [MY DOWNLOAD FOLDER]. Copy train.parquet, validation.parquet, test.parquet and manifest.json unchanged into data/01_raw/. Verify them against config/workshop-sample.lock.json. Preserve existing files and report any conflict or failed check.",
        checkpoint: "All four files pass their checksum checks.",
      },
      {
        id: "project",
        dependsOn: ["download-data"],
        location: "local",
        title: "Create and push your personal branch",
        time: "2 min",
        instruction: "Create {{branch}} locally, then check access before pushing.",
        prompt: `From the clean, up-to-date supplied version origin/${WORKSHOP_SOURCE_BRANCH}, create or safely resume {{branch}}. Preserve existing work. Set name: {{runName}} in config/experiments.yaml; keep validation, seed 42 and max_workers 1. Check the intended Git identity and access to origin before pushing. Never switch or copy credentials. If access is verified, commit only this setup and push the branch; confirm its GitHub URL. If authentication or permission is blocked, keep the branch and setup locally, report PUSH PENDING with the reason, and continue local workshop steps. Do not claim remote success or discard existing edits.`,
        checkpoint: "Personal branch exists locally. Verify its GitHub URL if pushed; otherwise record PUSH PENDING. Shared main is unchanged.",
      },
      {
        id: "overview",
        dependsOn: ["project"],
        location: "local",
        title: "Explore the code",
        time: "5 min",
        instruction: "Start a new project chat and ask Codex to create your own HTML code overview in docs/. Choose the layout and what to explore. Use the example below for ideas.",
        decision: "Which file would you change to add a model or a feature?",
        prompt: "Read this repository and create docs/workshop-overview.html titled Code overview. Make the page a Mermaid-style code flowchart: raw Parquet → PySpark preprocessing → prepared features → model training/prediction → results → Model Explorer. Show separately where training and validation data enter, and connect config/experiments.yaml to the steps it controls. Verify the flow against the code. Each node: a plain label and 1–2 main file paths. Click a node to show one sentence explaining its job, its inputs/outputs and its main function. Keep the diagram dominant; show only one detail panel at a time. Match the workshop Site: charcoal #282b2f, panels #30343a, off-white #f6f3ed, coral #ff737a and pale-blue arrows; thin borders, compact sans-serif labels, monospace paths. No hero, slogans, introductory paragraphs, formulas, sample scores or historical results. At most 80 words visible at once, excluding file paths. Use one self-contained HTML with inline SVG/CSS/JS; no framework, CDN or training run. Check it opens and the nodes work. Commit and push on {{branch}}, then link the HTML file.",
        checkpoint: "You can follow the pipeline and locate the files that control models and features.",
      },
      {
        id: "smoke",
        dependsOn: ["overview"],
        location: "local",
        title: "Run the baseline",
        time: "8 min · image built beforehand",
        instruction: "Run the existing pipeline to train the starting model and save its validation results.",
        prompt: "On {{branch}}, build the lab image if needed; run setup, tests, preprocessing, predict and postprocessing. Keep only the default logistic/basic experiment on validation. Copy prepared inputs to data/02_preprocessed_baseline; save config and comparison export under data/evidence/baseline without overwriting evidence. Show one validation example, its score and true label. Stop and explain failed checks.",
        decision: "Does the baseline classify your example correctly at a cutoff of 0.5?",
        concept: { title: "What just ran?", body: "Logistic regression learns from three supplied measurements: jet momentum, mass and particle count. It scores the validation rows; postprocessing compares those scores with the known answers. This saved result is the baseline for your own experiment." },
        hint: "Setup verifies the four data files; it downloads no models. Use your available Codex model. Build and run times depend on your laptop and network.",
        commands: "docker compose -p {{composePrefix}}-setup build lab\ndocker compose -p {{composePrefix}}-setup run --rm --no-deps setup\ndocker compose -p {{composePrefix}}-setup run --rm --no-deps lab -m pytest -q\ndocker compose -p {{composePrefix}}-setup run --rm --no-deps lab -m preprocessing\ndocker compose -p {{composePrefix}}-setup run --rm --no-deps lab -m predict\ndocker compose -p {{composePrefix}}-setup run --rm --no-deps lab -m postprocessing",
        checkpoint: "Checks pass, the baseline scores 1,000 validation examples, and its inputs and results are saved.",
      },
      {
        id: "worktrees",
        dependsOn: ["smoke"],
        location: "local",
        title: "Open two worktree chats",
        time: "5 min",
        instruction: "Open two Worktree chats from {{branch}}: one for the pipeline, one for models.",
        actions: [
          "Confirm your setup and HTML are committed and pushed.",
          "New chat → Worktree → choose {{branch}} as the starting branch.",
          "Do this twice, then copy the matching A or B prompt into each Worktree chat. Open Codex only prefills a chat; select Worktree before sending.",
          "While the pipeline chat measures, plan your experiments in the model chat.",
        ],
        concept: { title: "What is a worktree?", body: "A worktree is another folder connected to the same Git repository. Each chat can change files independently; its starter below creates a named branch. Clicking Mark complete on this Site only records your progress. It does not create a worktree, commit code or merge a PR." },
        hint: "The supplied .worktreeinclude copies raw and prepared inputs into each worktree. Outputs stay separate. Scikit-learn and XGBoost are already installed; their classifier integrations need no image rebuild.",
        extraPrompts: [
          { title: "Worktree A · pipeline", prompt: "First verify this chat is running in a separate Git worktree, not the original project checkout: inspect git worktree list, the current folder and the starting commit. If it is the original checkout, stop without changing files or branches and ask me to select Worktree for a new chat, starting from {{branch}}. Create or verify branch {{pipelineBranch}} from the current {{branch}} commit. Verify this worktree has matching raw and prepared inputs; copy missing inputs from the original checkout without sharing writable folders. Show both paths and the starting commit. We will change only SHUFFLE_PARTITIONS in src/preprocessing/pipeline.py. Use Compose project {{composePrefix}}-pipeline. Do not run Docker yet." },
          { title: "Worktree B · models", prompt: "First verify this chat is running in a separate Git worktree, not the original project checkout: inspect git worktree list, the current folder and the starting commit. If it is the original checkout, stop without changing files or branches and ask me to select Worktree for a new chat, starting from {{branch}}. Create or verify branch {{modelsBranch}} from the same {{branch}} commit. Verify matching inputs; copy missing inputs and saved baseline evidence without sharing writable folders. Show both paths and starting commit. Own model configuration/code and preprocessing/features.py; leave preprocessing/pipeline.py to the pipeline chat. Use Compose project {{composePrefix}}-models. Do not train yet." },
        ],
        checkpoint: "Two chats show different folders and branches, with the same starting code and input data.",
      },
    ],
  },
  {
    id: "pipeline",
    number: "01",
    label: "Change one setting",
    title: "Change one pipeline setting",
    time: "30–80 min · alongside the model exercise",
    description: "Worktree A · Predict, change, measure.",
    exercises: [
      {
        id: "profile",
        dependsOn: ["worktrees"],
        location: "pipeline",
        title: "Inspect the setting",
        time: "4 min",
        instruction: "Open src/preprocessing/pipeline.py and find SHUFFLE_PARTITIONS = 2048.",
        context: [
          { title: "The input.", body: "Our teaching sample contains 6,000 simulated jets: sprays of particles from collisions. Each jet record includes measurements and lists of its particles’ energies and directions." },
          { title: "Preprocessing.", body: "The pipeline validates these inputs, calculates numeric features such as total energy, the leading particle’s energy fraction and the energy spread and shape, checks their quality, and writes reusable training, validation and test tables. It prepares the model’s inputs; training happens later." },
          { title: "Spark.", body: "Spark is the data-processing engine. It divides work into batches called partitions. This workshop runs on one worker." },
        ],
        concept: { title: "Why try fewer partitions?", body: "The teaching baseline deliberately uses 2,048 shuffle partitions, with automatic partition combining disabled. Scheduling many tiny batches can cost time. Next we try 4, keeping the data and calculations the same, and check timing and output equality. A partition count is one setting; total task count also includes other pipeline stages." },
        decision: "Will changing 2,048 to 4 reduce time, task count, or both?",
        prompt: "In {{pipelineBranch}}, show where SHUFFLE_PARTITIONS is used and explain it with a simple 2,048-pieces versus 4-pieces sketch. Read the existing preprocessing manifest’s time and scheduled_tasks. Preserve data/02_preprocessed as data/02_preprocessed_baseline without overwriting an existing snapshot. Do not change code or run a profiler yet.",
        checkpoint: "You have a saved baseline and a prediction you can test.",
      },
      {
        id: "optimise",
        dependsOn: ["profile"],
        location: "pipeline",
        title: "Change 2,048 to 4 and measure",
        time: "8 min",
        instruction: "Change 2,048 to 4. Compare three runs per setting, then refresh the prepared data.",
        prompt: "Change only SHUFFLE_PARTITIONS to 4 in src/preprocessing/pipeline.py. With other Docker jobs stopped, use {{composePrefix}}-pipeline to run scripts/benchmark_preprocessing.py --before 2048 --after 4. It runs each setting three times and checks every saved value. Then run preprocessing to update data/02_preprocessed. Show the diff, all timings, median time reduction and equivalence result. Keep features and models unchanged. Report no improvement if that is what happened.",
        decision: "Would you keep this change, based on the measurements?",
        hint: "The benchmark alternates settings in fresh Spark processes, compares median times and checks all saved values. Outputs and logs go to data/05_analytics/preprocessing-benchmarks/.",
        commands: "docker compose -p {{composePrefix}}-pipeline run --rm --no-deps lab scripts/benchmark_preprocessing.py --before 2048 --after 4\ndocker compose -p {{composePrefix}}-pipeline run --rm --no-deps lab -m preprocessing",
        checkpoint: "The feature values are equivalent. You can explain the setting, the task count and the timing result.",
      },
      {
        id: "pr-review",
        dependsOn: ["optimise"],
        location: "pipeline",
        title: "Review the pipeline PR",
        time: "5 min",
        instruction: "Ask Codex to create the PR, then inspect it in the app’s Code review tab.",
        prompt: "Commit the pipeline change and concise before/after evidence. Push {{pipelineBranch}} and create a PR into {{branch}} using the GitHub plugin or gh. Return a clickable PR link so I can choose Open in → Code review. Exclude datasets and generated models. Leave the PR open and unmerged for review.",
        actions: [
          "Open the PR link’s context menu in your Codex chat and choose Open in → Code review.",
          "In Summary, confirm the target branch is {{branch}}. Open Changes to inspect the diff and before/after evidence.",
          "Choose Review with Codex, or ask for a review in the current review chat. Read the findings, fix relevant issues, push to the same PR and check the updated diff.",
          "Leave the PR open until both reviews are complete.",
        ],
        checkpoint: "The pipeline PR is open in Code review, targets your personal branch, and you have read its diff and findings.",
      },
    ],
  },
  {
    id: "models",
    number: "02",
    label: "Plan and compare",
    title: "Plan, run and explore experiments",
    time: "30–80 min · alongside the pipeline exercise",
    description: "Worktree B · Plan your variants, run them, then explore the results.",
    exercises: [
      {
        id: "experiments",
        dependsOn: ["worktrees"],
        location: "models",
        title: "Plan experiments",
        time: "8 min",
        instruction: "Discuss improvements and agree a short experiment plan in your main model worktree chat.",
        actions: [
          "Select Plan mode in your main model worktree chat. Use Copy prompt in that chat.",
          "Discuss opportunities to improve the baseline: features, parameters or another classifier.",
          "Agree the short plan here and keep this same chat for step 11.",
        ],
        decision: "Which variants will you run, and what do you expect?",
        concept: { title: "What is Plan mode?", body: "Discuss the approach and agree on the experiments before implementation. Stay in this model worktree chat, then approve the plan and switch to normal mode in the next step. Open in Codex prefills a new chat; use Copy prompt to continue here." },
        prompt: "In this {{modelsBranch}} worktree chat, use our discussion to write a short experiment plan for us to review here. Include the unchanged logistic/basic baseline plus 2–3 quick variants. For each, state the change, expected benefit and estimated implementation/run time. Target the 15-minute experiment step; flag anything likely to take longer. Use the same validation rows and seed 42, measured inputs only, and preserve original feature values. Keep test scores unseen. Plan only; do not implement or run anything yet. We will approve and run this plan in this same chat.",
        hint: "Only logistic regression is implemented. XGBoost is installed, but you build and register its Predictor adapter in predict/models.py. You can also tune logistic regression, select more features, or add a calculation in preprocessing/features.py.",
        checkpoint: "You have agreed a short experiment plan in the main model worktree chat, ready to approve and run there.",
      },
      {
        id: "train",
        dependsOn: ["experiments"],
        location: "models",
        title: "Run experiments",
        time: "15 min",
        instruction: "Approve the existing plan in the same model worktree chat, switch to normal mode, and run it after the pipeline Docker job finishes.",
        actions: [
          "Approve the plan already in this model worktree chat and select normal mode.",
          "Use Copy prompt in this same chat. Wait for the pipeline Docker job to finish, then implement and run the agreed batch using docs/model-outputs.md.",
          "Save result.json and predictions.parquet for each experiment in data/03_predictions/<run>-<experiment>/.",
          "Run postprocessing to generate data/05_analytics/comparison.json and data/05_analytics/model-explorer.html.",
          "Preserve the configuration and results. Do not start another experiment loop.",
          "While the batch runs, optionally choose New side chat for questions or Fork for a separate discussion. See More context below; keep the agreed batch unchanged.",
        ],
        prompt: "Implement the experiment plan we agreed in this {{modelsBranch}} worktree chat. If that plan is missing, stop and ask me to confirm it. Wait until the pipeline Docker job has finished before running the batch. Follow the shared Predictor/run/export contract in docs/model-outputs.md. Include the unchanged logistic/basic baseline and only the agreed 2–3 quick variants. Keep the same validation rows, seed 42, measured inputs and original feature values; leave test scores unseen. Test changes; rerun preprocessing if preprocessing/features.py changed. Run serially in {{composePrefix}}-models with max_workers 1 and validation only. Save data/03_predictions/<run>-<experiment>/{result.json,predictions.parquet}. Run postprocessing to write data/05_analytics/comparison.json and data/05_analytics/model-explorer.html. Preserve the configuration and results. Stop after this agreed batch; do not start another experiment loop.",
        context: [
          { title: "Quick questions: New side chat.", body: "After launching the batch, open the chat menu and choose New side chat. Use it to explain a model, feature or result while the main chat continues. For example: Explain our chosen models using the current code. Do not edit files or run experiments." },
          { title: "A separate direction: Fork.", body: "Choose Fork from the chat menu to continue with the conversation’s history in a separate chat, for example to discuss a future deployment. A chat fork can share the same folder; it does not automatically create a Git branch or worktree. Keep it to discussion while the batch runs. Choose a separate worktree if you later want independent code changes." },
        ],
        hint: "Postprocessing embeds the comparison results in one self-contained Model Explorer HTML file. Open it directly; no JSON file picker is needed.",
        commands: "docker compose -p {{composePrefix}}-models run --rm --no-deps lab -m predict\ndocker compose -p {{composePrefix}}-models run --rm --no-deps lab -m postprocessing",
        checkpoint: "The agreed batch and unchanged baseline have completed, with the configuration preserved and Model Explorer ready to open.",
      },
      {
        id: "explore-results",
        dependsOn: ["train"],
        location: "models",
        title: "Explore results",
        time: "5 min",
        instruction: "In Codex, choose + → Files → data/05_analytics/model-explorer.html to open Model Explorer.",
        actions: [
          "Compare validation ROC-AUC and time across all experiments and the baseline.",
          "Click a model to inspect its features and settings.",
          "Move the threshold, inspect the confusion matrix, then choose a model in the next step.",
        ],
        decision: "Which experiment best balances quality and run time?",
        prompt: "Verify data/05_analytics/model-explorer.html contains every planned experiment and the unchanged logistic/basic baseline, then open it from this same model worktree. Use existing results only: no reruns, new experiments or hand-written JSON. Help me inspect settings, validation quality, time and the threshold confusion matrix before choosing a model.",
        concept: { title: "How do we compare the models?", body: "ROC-AUC measures how well scores rank signal above background; higher is better. The confusion matrix counts correct and incorrect choices at one threshold. Validation helps us choose, so it is not a final independent test." },
        hint: "The matrix uses all 1,000 validation examples. Moving the threshold changes the decision rule without retraining. Timings describe these runs on your machine.",
        checkpoint: "Every planned experiment and the baseline are visible, and you can explain their quality/time trade-off.",
      },
      {
        id: "select",
        dependsOn: ["explore-results"],
        location: "models",
        title: "Choose your model and review its PR",
        time: "5 min",
        instruction: "Choose your model, ask Codex to create its PR, then inspect it in the app’s Code review tab.",
        prompt: "I choose [EXPERIMENT ID] because [MY REASON]. Before changing config/experiments.yaml, preserve the full batch configuration at data/evidence/models/experiments.yaml and the actual generated comparison at data/evidence/models/comparison.json. Follow docs/model-outputs.md; do not fabricate or trim predictions. Keep only the chosen experiment in config/experiments.yaml with validation evaluation. Record the selection reason. Commit the source/config changes, decision note and bounded comparison evidence needed for integration; exclude raw/prepared data, model weights and other generated outputs. Push {{modelsBranch}} and create a PR into {{branch}}. Return a clickable PR link so I can choose Open in → Code review. Leave it open and unmerged for review.",
        actions: [
          "Open the PR link’s context menu in your Codex chat and choose Open in → Code review.",
          "In Summary, confirm the target branch is {{branch}}. Open Changes to inspect the selected configuration, comparison evidence and decision note.",
          "Choose Review with Codex, or ask for a review in the current review chat. Read the findings, fix relevant issues, push to the same PR and check the updated diff.",
          "Leave this PR open until both reviews are complete, then continue to Merge both PRs.",
        ],
        hint: "Submit review records a comment, approval or request for changes. Approval does not merge the PR. If the PR is missing from your personal list, paste its URL into Code Review search.",
        checkpoint: "Your model PR is open in Code review and targets your personal branch. You have reviewed the choice, evidence, configuration and findings.",
      },
    ],
  },
  {
    id: "integration",
    number: "03",
    label: "Merge & verify",
    title: "Merge and check",
    time: "80–100 min",
    description: "Merge both PRs and run the combined code.",
    exercises: [
      {
        id: "integrate",
        dependsOn: ["pr-review", "select"],
        location: "integration",
        title: "Merge both PRs",
        time: "5 min",
        instruction: "After reviewing both PRs, use Merge in Codex to merge them into {{branch}}.",
        actions: [
          "Open each PR in the full Code review view. Recheck the target branch, latest diff, required checks and outstanding feedback. Use Review with Codex if review is still pending.",
          "If the PR is a draft, choose Mark ready. Choose Merge and confirm the merge method. If these controls are unavailable, choose Open in GitHub and finish there.",
          "Resolve any permission, check or conflict blocker. Verify both PRs show Merged into {{branch}}; an approval alone does not merge.",
          "Return to the original checkout on {{branch}}. Preserve and commit any intended local source/config changes before integrating. Pull when the checkout is clean; ask Codex to reconcile divergence without discarding work.",
        ],
        concept: { title: "What does merging bring back?", body: "A merge combines the tracked code changes. Pull brings the merged branch to your local folder. Ignored data and model outputs stay in their worktrees, so keep both worktrees until the final check and submission are complete." },
        commandTitle: "Pull in the original checkout · stop if there are uncommitted changes",
        commands: "git status --short\ngit branch --show-current\n# Confirm this is the original checkout on {{branch}} with a clean working tree.\ngit pull --ff-only origin '{{branch}}'",
        checkpoint: "Both PRs are Merged into your personal branch. The original checkout contains the Spark setting and your chosen model configuration.",
      },
      {
        id: "final-test",
        dependsOn: ["integrate"],
        location: "integration",
        title: "Run the tests",
        time: "15 min",
        instruction: "Check the merged code, then evaluate your chosen model on the 1,000 test jets.",
        actions: [
          "Run the automated code tests and check preprocessing preserves the original features.",
          "Keep the model chosen on validation fixed. Evaluate it on the test dataset.",
          "Check the test scores and generate the JSON for publication.",
        ],
        prompt: [
          "- On {{branch}}, use the model chosen on validation. Keep its features and settings unchanged.",
          "- Run the automated test suite in {{composePrefix}}-integration and stop if it fails. Check the merged code and prepared inputs in this original checkout. If preprocessing/features.py changed or the prepared feature hash is stale, rerun preprocessing in {{composePrefix}}-integration. Run scripts/compare_preprocessing.py data/02_preprocessed_baseline data/02_preprocessed --allow-added-features to verify all original values are preserved. Stop if checks fail.",
          "- Set evaluation: test in config/experiments.yaml, then run predict in {{composePrefix}}-integration with the frozen selected configuration.",
          "- Run postprocessing with --import-comparison data/evidence/models/comparison.json to preserve the model worktree's validation history while updating Model Explorer and generating the submission JSON in data/04_submissions/. Stop if the evidence is missing. Verify the baseline, agreed variants and final selected run are all present; do not rerun old experiments to recreate history.",
          "- Open data/05_analytics/model-explorer.html, show the test results and give me the submission file path. Do not tune the model on test data.",
        ].join("\n"),
        hint: "predict refits the selected configuration on the training data before scoring validation and test. Use the test scores only for the final submission, not to choose or tune models.",
        checkpoint: "Code and feature checks pass; the final result contains 1,000 test predictions, test metrics and a submission JSON.",
      },

    ],
  },
  {
    id: "submit",
    number: "04",
    label: "Finish",
    title: "Publish your results",
    time: "100–105 min",
    description: "Upload the generated JSON to the Leaderboard.",
    exercises: [
      {
        id: "upload",
        dependsOn: ["final-test"],
        location: "integration",
        title: "Publish your results",
        time: "3 min",
        instruction: "Publish your final result on the Leaderboard by uploading its generated JSON.",
        actions: [
          "Ask Codex to check the generated JSON in data/04_submissions/ and give you its exact path.",
          "Open Leaderboard, sign in and upload that JSON file.",
          "Check the model and run name, then click Submit my result.",
          "Confirm the result is accepted and appears under your account.",
        ],
        prompt: [
          "- Find the generated data/04_submissions/ JSON for my chosen model’s verified final test. Do not rerun or tune the model.",
          "- Validate it against config/evaluation.json with postprocessing.leaderboard. Check name: {{runName}}, all 1,000 validation and 1,000 test IDs, valid scores and a file size under 1 MB.",
          "- Commit and push any remaining source/config changes to {{branch}}. Keep generated data and results locally, outside Git.",
          "- Give me the exact JSON file path to upload on the Leaderboard. I will click Submit my result myself. Report any failed check; do not change reported scores or claim the upload is complete.",
        ].join("\n"),
        hint: "Upload only the generated result JSON, not raw data, code or model files. The server validates its contents and recomputes the metrics from its scores. Participant-reported timings are not independently rerun.",
        checkpoint: "Your final-test result is accepted by the leaderboard.",
      },
    ],
  },
];

// These extensions are deliberately outside the core sequence and its progress count.
export const optionalWorkshopExercises: WorkshopExercise[] = [
  {
    id: "sophon-reference",
    dependsOn: ["train"],
    location: "models",
    optional: true,
    title: "Optional: run Sophon",
    time: "Early finishers or closing demo",
    instruction: "Sophon is a pretrained transformer that uses the particles inside each jet. Compare its predictions with your own models on validation.",
    actions: [
      "Ask Codex to summarise the paper: its inputs, what it learned and how it differs from your model.",
      "Create {{runName}}-experiment-sophon from {{modelsBranch}} in the model worktree.",
      "Download the pack, run the supplied model, then compare it in Model Explorer.",
    ],
    download: { label: "Download the Sophon pack", href: "/downloads/sophon-optional-v1.zip" },
    prompt: "In the model worktree, preserve and commit completed model code on {{modelsBranch}}, excluding generated data and weights. Create and switch to {{runName}}-experiment-sophon from that commit; if it exists, verify and resume it without resetting work. Summarise https://arxiv.org/abs/2405.12972 in three short sentences. Extract the downloaded Sophon pack into optional/ and follow the repository README to install it with Docker. In config/experiments-sophon.yaml, use name: {{runName}} as the only run label. Run predict with that config, then postprocessing in {{composePrefix}}-sophon when other Docker jobs have finished. Follow docs/model-outputs.md; preserve existing results and compare Sophon with the baseline and my models in Model Explorer on validation only. Use the supplied weights and adapter unchanged; no training, Spark rerun or new dependencies. Commit only added source/config files on the Sophon branch; keep it separate from {{branch}}.",
    hint: "The pack includes verified weights and the input adapter. This is a frozen reference, not a coding or fine-tuning exercise.",
    commandTitle: "Run after creating the Sophon branch",
    commands: "docker run --rm --network none -v \"$PWD:/workspace\" particle-workshop:0.6.0 optional/sophon-optional/install.py /workspace\ndocker compose -p {{composePrefix}}-sophon run --rm --no-deps lab -m predict --config config/experiments-sophon.yaml\ndocker compose -p {{composePrefix}}-sophon run --rm --no-deps lab -m postprocessing",
    checkpoint: "Sophon’s validation result is compared with your baseline and labelled as a frozen reference.",
  },
];

export const coreWorkshopExercises = workshopParts.flatMap((part) => part.exercises);
export const workshopExercises = [...coreWorkshopExercises, ...optionalWorkshopExercises];
