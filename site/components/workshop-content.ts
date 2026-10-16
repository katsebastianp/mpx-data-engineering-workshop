export type WorkshopExercise = {
  id: string;
  title: string;
  instruction: string;
  actions?: string[];
  hint?: string;
  prompt?: string;
  decision?: string;
  concept?: { title: string; body: string };
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

export const WORKSHOP_REPOSITORY_URL = "https://github.com/openai/machine-learning-lhc-workshop";
export const WORKSHOP_SOURCE_BRANCH = "main";
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
        instruction: "Choose a run name above. Create an empty folder called machine-learning-lhc-workshop and select it as your Codex project.",
        actions: [
          "Start a chat in that project and use the prompt below.",
          "Clone directly into the project folder. The project folder must be the Git repository root for worktrees.",
        ],
        prompt: `Use the GitHub plugin to check access to ${WORKSHOP_REPOSITORY_URL}. In this Codex project's empty folder, clone its ${WORKSHOP_SOURCE_BRANCH} branch directly into . (the current folder), without creating a subfolder. If this folder is already the repository root, verify the remote and reuse it. If it is nonempty and not the repository root, stop and explain; preserve all files. Show the terminal command as a fallback. Confirm git rev-parse --show-toplevel matches the Codex project folder, and README.md, compose.yaml and src/ are directly inside it.`,
        commandTitle: "Terminal fallback · run in the empty project folder",
        commands: `gh auth status\ngh repo clone openai/machine-learning-lhc-workshop . -- -b ${WORKSHOP_SOURCE_BRANCH}\n# If GitHub CLI is unavailable and Git access is already configured:\n# git clone -b ${WORKSHOP_SOURCE_BRANCH} ${WORKSHOP_REPOSITORY_URL}.git .`,
        checkpoint: "The Codex project folder is the Git repository root, with README.md directly inside it.",
      },
      {
        id: "download-data",
        dependsOn: ["codex-project"],
        location: "local",
        title: "Download the workshop data",
        time: "2 min",
        instruction: "Download all four files and tell Codex where you saved them.",
        prompt: "The four workshop downloads are in [MY DOWNLOAD FOLDER]. Copy train.parquet, validation.parquet, test.parquet and manifest.json unchanged into data/01_raw/. Verify them against config/workshop-sample.lock.json. Preserve existing files and report any conflict or failed check.",
        checkpoint: "All four files pass their checksum checks.",
      },
      {
        id: "project",
        dependsOn: ["download-data"],
        location: "local",
        title: "Create and push your personal branch",
        time: "2 min",
        instruction: "Create {{branch}} and push it to GitHub.",
        prompt: `From the clean, up-to-date supplied version origin/${WORKSHOP_SOURCE_BRANCH}, create or safely resume {{branch}}. Preserve existing work. Set name: {{runName}} in config/experiments.yaml; keep validation, seed 42 and max_workers 1. Commit this setup and push the branch to origin. Confirm the GitHub branch URL and write access.`,
        checkpoint: "Open the GitHub link and find your personal branch. Shared main is unchanged.",
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
        time: "8 min + first image build",
        instruction: "Start Docker and run logistic regression with the three supplied features.",
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
          "Do this twice, then use the Worktree A and B prompts below.",
          "While the pipeline chat measures, plan your experiments in the model chat.",
        ],
        concept: { title: "What is a worktree?", body: "A worktree is another folder connected to the same Git repository. Each chat can change files independently; its starter below creates a named branch. Clicking Mark complete on this Site only records your progress. It does not create a worktree, commit code or merge a PR." },
        hint: "The supplied .worktreeinclude copies raw and prepared inputs into each worktree. Outputs stay separate. Scikit-learn and XGBoost are already installed; their classifier integrations need no image rebuild.",
        extraPrompts: [
          { title: "Worktree A · pipeline", prompt: "Create or verify branch {{pipelineBranch}} from the current {{branch}} commit. Verify this worktree has matching raw and prepared inputs; copy missing inputs from the original checkout without sharing writable folders. Show both paths and the starting commit. We will change only SHUFFLE_PARTITIONS in src/preprocessing/pipeline.py. Use Compose project {{composePrefix}}-pipeline. Do not run Docker yet." },
          { title: "Worktree B · models", prompt: "Create or verify branch {{modelsBranch}} from the same {{branch}} commit. Verify matching inputs; copy missing inputs and saved baseline evidence without sharing writable folders. Show both paths and starting commit. Own model configuration/code and preprocessing/features.py; leave preprocessing/pipeline.py to the pipeline chat. Use Compose project {{composePrefix}}-models. Do not train yet." },
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
        concept: { title: "What is a shuffle partition?", body: "Spark schedules work in partitions. This starter deliberately uses 2,048 for just 6,000 jets on one worker. We will reduce that overhead and compare runtimes." },
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
        instruction: "Ask Codex to create the PR, then review it yourself.",
        prompt: "Commit the pipeline change and concise before/after evidence. Push {{pipelineBranch}} and create a PR into {{branch}} using the GitHub plugin or gh. Give me the PR URL. Exclude datasets and generated models; leave the PR open.",
        actions: [
          "Open the PR on GitHub and check that its base is {{branch}}.",
          "In Codex, choose Review PR (or Code Review → select the PR → Review with Codex).",
          "Read the findings. Ask Codex to fix relevant issues, commit and push to the same PR; verify the updated diff. Leave it open.",
        ],
        checkpoint: "A real PR URL is in your chat. You have read the diff and the review findings.",
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
        instruction: "Discuss improvements and write a short experiment plan in a side chat.",
        actions: [
          "In the main model worktree chat, type /side to open a side chat.",
          "Discuss opportunities to improve the baseline: features, parameters or another classifier.",
          "Stay in the side chat. Select Plan mode and ask for a short plan of experiments that are quick to run.",
        ],
        decision: "Which variants will you run, and what do you expect?",
        concept: { title: "What is Plan mode?", body: "Use Plan mode in the side chat to agree on the experiments. Implementation and training happen in the main model worktree chat." },
        prompt: "Based on our discussion, write a short experiment plan I can paste into the main model chat. Include the unchanged logistic/basic baseline plus 2–3 quick variants. For each, state the change, expected benefit and estimated implementation/run time. Target the 15-minute experiment step; flag anything likely to take longer. Use the same validation rows and seed 42, measured inputs only, and preserve original feature values. Keep test scores unseen. Plan only; do not implement or run anything here.",
        hint: "Only logistic regression is implemented. XGBoost is installed, but you build and register its Predictor adapter in predict/models.py. You can also tune logistic regression, select more features, or add a calculation in preprocessing/features.py.",
        checkpoint: "The side chat has produced a short plan, ready to paste into the main model chat.",
      },
      {
        id: "train",
        dependsOn: ["experiments"],
        location: "models",
        title: "Run experiments",
        time: "15 min",
        instruction: "Run your plan after the pipeline Docker job finishes.",
        actions: [
          "Copy-paste your plan from the side chat into the main model worktree chat.",
          "In normal mode, ask Codex to implement and run it using docs/model-outputs.md.",
          "Save result.json and predictions.parquet for each experiment in data/03_predictions/<run>-<experiment>/.",
          "Run postprocessing to generate data/05_analytics/comparison.json and data/05_analytics/model-explorer.html.",
          "Preserve the configuration and results.",
        ],
        prompt: "Implement the experiment plan pasted above on {{modelsBranch}} using the shared Predictor/run/export contract in docs/model-outputs.md. Include the unchanged logistic/basic baseline. Test changes; rerun preprocessing if preprocessing/features.py changed. Run serially in {{composePrefix}}-models with max_workers 1 and validation only. Save data/03_predictions/<run>-<experiment>/{result.json,predictions.parquet}. Run postprocessing to write data/05_analytics/comparison.json and data/05_analytics/model-explorer.html. Preserve the configuration and results.",
        hint: "Postprocessing embeds the comparison results in one self-contained Model Explorer HTML file. Open it directly; no JSON file picker is needed.",
        commands: "docker compose -p {{composePrefix}}-models run --rm --no-deps lab -m predict\ndocker compose -p {{composePrefix}}-models run --rm --no-deps lab -m postprocessing",
        checkpoint: "All planned experiments and the unchanged baseline have completed, with Model Explorer ready to open.",
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
        instruction: "Choose your model, ask Codex to create its PR, then review it yourself.",
        prompt: "I choose [EXPERIMENT ID] because [MY REASON]. Keep that experiment in config/experiments.yaml with validation evaluation, and preserve the comparison evidence and decision notes. Commit, push {{modelsBranch}} and create a PR into {{branch}}. Give me its URL and leave it open. Exclude generated data and models.",
        actions: [
          "Check the chosen model’s configuration on GitHub and confirm the base is {{branch}}.",
          "In Codex, choose Review PR (or Code Review → select the PR → Review with Codex).",
          "Read the findings. Ask Codex to fix relevant issues, commit and push to the same PR; verify the updated diff. Leave it open.",
        ],
        checkpoint: "Your model choice has a clear reason and a real PR. You have reviewed its configuration and findings.",
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
        instruction: "Merge both reviewed PRs into {{branch}} using the app.",
        actions: [
          "Click Merge for each PR; use GitHub if the app has no merge control.",
          "Verify both PRs show Merged into {{branch}} on GitHub.",
          "Return to the original checkout and pull {{branch}}.",
        ],
        concept: { title: "What does merging bring back?", body: "A merge combines the tracked code changes. Pull brings the merged branch to your local folder. Ignored data and model outputs stay in their worktrees, so keep both worktrees until the final check and results page are ready." },
        commandTitle: "Pull in the original checkout · stop if there are uncommitted changes",
        commands: "git status --short\ngit branch --show-current\n# Confirm this is the original checkout on {{branch}} with a clean working tree.\ngit pull --ff-only origin '{{branch}}'",
        checkpoint: "GitHub marks both PRs Merged. The original checkout contains the Spark setting and your chosen model configuration.",
      },
      {
        id: "preprocess",
        dependsOn: ["integrate"],
        location: "integration",
        title: "Check the combined result",
        time: "15 min",
        instruction: "Run the merged code and check the original features and your experiment results.",
        prompt: "On {{branch}}, preserve the pipeline evidence and copy the model worktree’s data/05_analytics/comparison.json to data/evidence/models/comparison.json. Run tests and preprocessing in {{composePrefix}}-integration. Run scripts/compare_preprocessing.py data/02_preprocessed_baseline data/02_preprocessed --allow-added-features; test new features. Run the chosen model on validation, then postprocessing --import-comparison data/evidence/models/comparison.json. Confirm Model Explorer contains the full planned batch and baseline alongside the integration run. Explain differences without retuning or inspecting test scores.",
        commandTitle: "Export the complete comparison after the integration run",
        commands: "docker compose -p {{composePrefix}}-integration run --rm --no-deps lab -m postprocessing --import-comparison data/evidence/models/comparison.json",
        hint: "The pipeline PR checks exact equality before model features are added. After merging, check the original eight values plus tests for any new features. Keep both worktrees until this passes; Git does not copy their ignored outputs.",
        checkpoint: "Original features are unchanged, new features pass checks, and Model Explorer retains every planned experiment plus the integration run.",
      },
    ],
  },
  {
    id: "site",
    number: "04",
    label: "Make it your own",
    title: "Build your results page",
    time: "100–120 min",
    description: "Choose the design; include a threshold slider and confusion matrix.",
    exercises: [
      {
        id: "results-site",
        dependsOn: ["preprocess"],
        location: "integration",
        title: "Build your results Site",
        time: "15 min + 5 min to explain",
        instruction: "Build one page with the Sites plugin, or use Model Explorer to present your results.",
        decision: "What should someone learn from your results page?",
        actions: [
          "Add a threshold slider linked to the confusion matrix.",
          "Choose one extra: pipeline timings, model comparison, or a misclassified example.",
          "If Sites is unavailable or generation takes more than 10 minutes, open data/05_analytics/model-explorer.html.",
          "Try the slider, then explain your result in one minute.",
        ],
        prompt: "Use the Sites plugin to make one simple results page for [MY AUDIENCE], focused on [MY STORY]. Use the merged data/05_analytics/comparison.json, including all planned experiments and the baseline. Include a threshold slider and confusion matrix recomputed from all validation predictions, plus [MY CHOSEN EXTRA]. Keep it small and interactive. Explain the two error types and label these as validation results. Check the slider and source counts.",
        concept: { title: "What does the threshold change?", body: "A model gives each example a score. The threshold decides which scores count as signal. Moving it changes the number of signals you keep and backgrounds you accept; it does not retrain the model. The matrix should always contain the same 1,000 validation examples." },
        hint: "Either page completes this step. Publishing is optional; verify the audience before sharing a link.",
        checkpoint: "Your slider works on all validation examples, and you can explain one decision from the experiment.",
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
  {
    id: "final-test",
    dependsOn: ["results-site"],
    location: "integration",
    optional: true,
    title: "Optional: run the final test",
    time: "After the core workshop",
    instruction: "For the leaderboard, evaluate your chosen model once on the untouched test examples.",
    prompt: "Keep my selected model, features, parameters and seed fixed. On {{branch}}, set evaluation: test and run predict then postprocessing once in {{composePrefix}}-integration. Reuse an existing completed final run if present. Preserve the final artifact and generated submission JSON. Explain the result without retuning from it, and give me the file to upload.",
    hint: "predict refits the selected configuration on the training data before scoring validation and test. This optional result is eligible for the final-test board; it is separate from the core validation exercise.",
    checkpoint: "One final-test result is preserved, with no tuning based on its score.",
  },
  {
    id: "upload",
    dependsOn: ["final-test"],
    location: "integration",
    optional: true,
    title: "Optional: upload your result",
    time: "3 min",
    instruction: "Upload the JSON generated by your optional final test.",
    prompt: "Find the generated data/04_submissions/ JSON for my chosen model’s final test. Check the run name, complete validation/test IDs and file size against the Site’s upload limit. Give me the exact file path. I will upload it myself; do not change the reported values.",
    hint: "Upload only the generated result JSON, not raw data, code or model files. The server validates its contents and recomputes the metrics from its scores. Participant-reported timings are not independently rerun.",
    checkpoint: "Your final-test result is accepted by the leaderboard.",
  },
];

export const coreWorkshopExercises = workshopParts.flatMap((part) => part.exercises);
export const workshopExercises = [...coreWorkshopExercises, ...optionalWorkshopExercises];
