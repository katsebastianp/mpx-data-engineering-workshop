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
export const WORKSHOP_SOURCE_BRANCH = "workshop/e2e-redesign-20261015";
export const WORKSHOP_SOURCE_URL = `${WORKSHOP_REPOSITORY_URL}/tree/${WORKSHOP_SOURCE_BRANCH}`;

export const workshopParts: WorkshopPart[] = [
  {
    id: "intro",
    number: "00",
    label: "Setup & understand",
    title: "Prepare the project",
    time: "00–25 min · allow extra for first-time setup",
    description: "Get the code, follow one example, and run the baseline.",
    exercises: [
      {
        id: "codex-project",
        dependsOn: [],
        location: "local",
        title: "Create your Codex project",
        time: "3 min",
        instruction: "Create a Codex project called Collision Lab with an empty folder, then start a chat.",
        actions: [
          "Clone with the GitHub plugin, or use the terminal command Codex shows you.",
          "Under Edit project, set the cloned folder as primary and start a chat there.",
        ],
        prompt: `Use the GitHub plugin to check access to ${WORKSHOP_REPOSITORY_URL} and clone its ${WORKSHOP_SOURCE_BRANCH} branch into this project. Show the terminal command as a fallback. Preserve existing files. Give me the clone’s absolute path, then confirm you can read README.md, compose.yaml and src/.`,
        commandTitle: "Terminal fallback · run in the empty project folder",
        commands: `gh auth status\ngh repo clone openai/machine-learning-lhc-workshop -- -b ${WORKSHOP_SOURCE_BRANCH}\n# If GitHub CLI is unavailable and Git access is already configured:\n# git clone -b ${WORKSHOP_SOURCE_BRANCH} ${WORKSHOP_REPOSITORY_URL}.git`,
        checkpoint: "Codex can read the cloned repository, and you know its folder on your computer.",
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
        prompt: `From the clean, up-to-date supplied version origin/${WORKSHOP_SOURCE_BRANCH}, create or safely resume {{branch}}. Preserve existing work. Set team: {{participantId}} in config/experiments.yaml; keep validation, seed 42 and max_workers 1. Commit this setup and push the branch to origin. Confirm the GitHub branch URL and write access.`,
        concept: { title: "Why the team field?", body: "The result-sharing page uses this generated participant ID to connect an uploaded result to you. Set it once; it is metadata, not a model input. A commit saves a version locally. Push copies that version to GitHub." },
        checkpoint: "Open the GitHub link and find your personal branch. Shared main is unchanged.",
      },
      {
        id: "overview",
        dependsOn: ["project"],
        location: "local",
        title: "Explore the code",
        time: "5 min",
        instruction: "Start a new project chat, then open and explore the HTML diagram Codex creates.",
        decision: "What enters and leaves the processing step you clicked?",
        prompt: "Explore this repository. Create a clear, attractive single-file docs/workshop-overview.html: clickable flow from one real validation example → measured features → model → signal/background score. Start with docs/assets/jet-examples.json; show its actual values and exact source files/functions at each node; explain code structure in plain English. Keep it small, no framework. Label unavailable predictions rather than inventing them. Commit and push on {{branch}}, then link the HTML file.",
        hint: "A score says how signal-like an example looks to the model. It is not automatically a calibrated probability. The true signal/background label is the answer used for training and checking; it must never be an input feature.",
        checkpoint: "The HTML opens, its example comes from the dataset, and you can explain raw data → features → score.",
      },
      {
        id: "smoke",
        dependsOn: ["overview"],
        location: "local",
        title: "Run the baseline",
        time: "8 min + first image build",
        instruction: "Start Docker and run logistic regression with the three supplied features.",
        prompt: "On {{branch}}, build the lab image if needed; run setup with --skip-sophon, tests, preprocessing, predict and postprocessing. Keep only the default logistic/basic experiment on validation. Copy prepared inputs to data/02_preprocessed_baseline; save config and comparison export under data/evidence/baseline without overwriting evidence. Show one validation example, its score and true label. Stop and explain failed checks.",
        decision: "Does the baseline classify your example correctly at a cutoff of 0.5?",
        concept: { title: "What just ran?", body: "Logistic regression learns from three supplied measurements: jet momentum, mass and particle count. It scores the validation rows; postprocessing compares those scores with the known answers. This saved result is the baseline for your own experiment." },
        hint: "The core path skips the large Sophon reference download. Use your available Codex model; Ultra is not required. Build time and run time depend on your laptop and network, so the agenda is a target, not a guarantee.",
        commands: "docker compose -p {{composePrefix}}-setup build lab\ndocker compose -p {{composePrefix}}-setup run --rm --no-deps setup scripts/setup_workshop.py --skip-sophon\ndocker compose -p {{composePrefix}}-setup run --rm --no-deps lab -m pytest -q\ndocker compose -p {{composePrefix}}-setup run --rm --no-deps lab -m preprocessing\ndocker compose -p {{composePrefix}}-setup run --rm --no-deps lab -m predict\ndocker compose -p {{composePrefix}}-setup run --rm --no-deps lab -m postprocessing",
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
          "Create both Worktree chats from {{branch}} using the starters below.",
          "Run one Docker job at a time.",
        ],
        concept: { title: "What is a worktree?", body: "A worktree is another folder connected to the same Git repository. Each chat can change files independently; its starter below creates a named branch. Clicking Mark complete on this Site only records your progress. It does not create a worktree, commit code or merge a PR." },
        hint: "The supplied .worktreeinclude copies raw and prepared inputs into each worktree. Outputs stay separate. Both chats reuse the existing Docker image; rebuild only if your chosen experiment adds dependencies.",
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
    time: "25–55 min · alongside the model exercise",
    description: "Worktree A · Predict, change, measure.",
    exercises: [
      {
        id: "profile",
        dependsOn: ["worktrees"],
        location: "pipeline",
        title: "Inspect the setting",
        time: "4 min",
        instruction: "Open src/preprocessing/pipeline.py and find SHUFFLE_PARTITIONS = 64.",
        concept: { title: "What is a shuffle partition?", body: "Spark divides grouped work into pieces called partitions. More pieces can add scheduling overhead on a small local dataset. Fewer pieces might help here, but too few can limit parallelism on larger jobs. We will measure rather than assume a speedup." },
        decision: "Will changing 64 to 4 reduce time, task count, or both?",
        prompt: "In {{pipelineBranch}}, show where SHUFFLE_PARTITIONS is used and explain it with a simple 64-pieces versus 4-pieces sketch. Read the existing preprocessing manifest’s time and scheduled_tasks. Preserve data/02_preprocessed as data/02_preprocessed_baseline without overwriting an existing snapshot. Do not change code or run a profiler yet.",
        checkpoint: "You have a saved baseline and a prediction you can test.",
      },
      {
        id: "optimise",
        dependsOn: ["profile"],
        location: "pipeline",
        title: "Change 64 to 4 and measure",
        time: "8 min",
        instruction: "Change 64 to 4, rerun preprocessing, and read the before/after comparison.",
        prompt: "Change only SHUFFLE_PARTITIONS from 64 to 4 in src/preprocessing/pipeline.py. With other Docker jobs stopped, run preprocessing in {{composePrefix}}-pipeline, then scripts/compare_preprocessing.py data/02_preprocessed_baseline data/02_preprocessed. Show the one-line diff, task counts, elapsed times and value-equivalence result. Keep feature definitions and models unchanged. Record the result, including no improvement if that is what happened.",
        decision: "Would you keep this change, based on the measurements?",
        hint: "The comparison aligns record IDs and checks every saved value, including features, flags and particle arrays. This one-setting change should preserve them exactly. A single timing run is a workshop observation. If time permits, repeat both settings on an idle machine before making a stronger speed claim.",
        commands: "docker compose -p {{composePrefix}}-pipeline run --rm --no-deps lab -m preprocessing\ndocker compose -p {{composePrefix}}-pipeline run --rm --no-deps lab scripts/compare_preprocessing.py data/02_preprocessed_baseline data/02_preprocessed",
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
          "Read the findings, fix relevant issues, and leave the PR open.",
        ],
        checkpoint: "A real PR URL is in your chat. You have read the diff and the review findings.",
      },
    ],
  },
  {
    id: "models",
    number: "02",
    label: "Design an experiment",
    title: "Design your model experiment",
    time: "25–55 min · alongside the pipeline exercise",
    description: "Worktree B · Choose a question, then test it.",
    exercises: [
      {
        id: "experiments",
        dependsOn: ["worktrees"],
        location: "models",
        title: "Plan your experiment",
        time: "8 min",
        instruction: "Discuss model ideas in a side chat, then plan one experiment in the model worktree.",
        actions: [
          "Ask: What could improve this baseline?",
          "Ask: Which small experiment would test that?",
          "Return to the model worktree, select Plan (or /plan), and agree on the experiment.",
        ],
        decision: "What will you change, and what result do you expect?",
        concept: { title: "What is Plan mode?", body: "Plan mode is for working out the approach before implementation. Use it to discuss choices, constraints and checks. Here the task is classification: logistic regression predicts a class score; ordinary linear regression is not the intended baseline." },
        prompt: "Help me plan [MY QUESTION AND HYPOTHESIS]. Discuss a small change to the classifier, parameters or features, then let me choose. Compare with the saved logistic baseline on the same validation rows and seed 42. Estimate the work and run time. Use measured inputs, preserve the original eight feature values and keep test scores unseen.",
        hint: "Options include tuning logistic regression, using more features, adding a calculated feature in preprocessing/features.py, or trying XGBoost. basic uses three supplied measurements; shape adds five calculated features. Register a new classifier in predict/models.py. Sophon here is a frozen ONNX reference; fine-tuning needs a separate training implementation.",
        checkpoint: "You can explain your chosen change, expected result and comparison with the baseline.",
      },
      {
        id: "train",
        dependsOn: ["experiments"],
        location: "models",
        title: "Run your experiment",
        time: "10 min",
        instruction: "Leave Plan mode and run your comparison once the pipeline Docker job finishes.",
        prompt: "Implement our chosen experiment on {{modelsBranch}} and test the changes. Rerun preprocessing if preprocessing/features.py changed. Run predict and postprocessing in {{composePrefix}}-models with max_workers 1 and validation only. Save config and results under data/evidence/models. Compare with the saved baseline: ROC-AUC, mistakes at 0.5, training and inference time. Show one actual mistake or changed prediction.",
        decision: "Did your change improve the baseline enough to keep it?",
        concept: { title: "How do we compare the models?", body: "ROC-AUC measures how well the scores put signal above background across possible cutoffs; higher is better. The confusion matrix counts correct and incorrect choices at one cutoff. Validation results help us choose, so they are not a final independent test." },
        hint: "Keep the same data and run one heavy job at a time. Use all 1,000 validation examples for metrics. Timing is an observation on your machine, not a universal ranking.",
        commands: "docker compose -p {{composePrefix}}-models run --rm --no-deps lab -m predict\ndocker compose -p {{composePrefix}}-models run --rm --no-deps lab -m postprocessing",
        checkpoint: "You have a saved comparison and can explain one quality/speed trade-off using the actual results.",
      },
      {
        id: "select",
        dependsOn: ["train"],
        location: "models",
        title: "Choose your model and review its PR",
        time: "5 min",
        instruction: "Choose your model, ask Codex to create its PR, then review it yourself.",
        prompt: "I choose [EXPERIMENT ID] because [MY REASON]. Keep that experiment in config/experiments.yaml with validation evaluation, and preserve the comparison evidence and decision notes. Commit, push {{modelsBranch}} and create a PR into {{branch}}. Give me its URL and leave it open. Exclude generated data and models.",
        actions: [
          "Check the chosen model’s configuration on GitHub and confirm the base is {{branch}}.",
          "In Codex, choose Review PR (or Code Review → select the PR → Review with Codex).",
          "Read the findings, fix relevant issues, and leave the PR open.",
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
    time: "55–70 min",
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
        time: "10 min",
        instruction: "Run the merged code and check the original features and your experiment results.",
        prompt: "On {{branch}}, preserve outputs and copy both worktrees’ evidence into separate data/evidence folders. Run tests and preprocessing in {{composePrefix}}-integration. Use scripts/compare_preprocessing.py with --allow-added-features to check original values against baseline, and test new features. Run the chosen model and postprocessing on validation; compare with its saved results. Explain differences without retuning or inspecting test scores.",
        hint: "The pipeline PR checks exact equality before model features are added. After merging, check the original eight values plus tests for any new features. Keep both worktrees until this passes; Git does not copy their ignored outputs.",
        checkpoint: "The original eight features are unchanged, any added features pass checks, and the chosen model’s validation result is consistent.",
      },
    ],
  },
  {
    id: "site",
    number: "04",
    label: "Make it your own",
    title: "Build your results page",
    time: "70–90 min",
    description: "Choose the design; include a threshold slider and confusion matrix.",
    exercises: [
      {
        id: "results-site",
        dependsOn: ["preprocess"],
        location: "integration",
        title: "Build your results Site",
        time: "15 min + 5 min to explain",
        instruction: "Use the Sites plugin to build one page from your saved results.",
        decision: "What should someone learn from your results page?",
        actions: [
          "Add a threshold slider linked to the confusion matrix.",
          "Choose one extra: pipeline timings, model comparison, or a misclassified example.",
          "Try the slider, then explain your result in one minute.",
        ],
        prompt: "Use the Sites plugin to make one simple results page for [MY AUDIENCE], focused on [MY STORY]. Use my actual saved validation results. Include a threshold slider and confusion matrix recomputed from all validation predictions, plus [MY CHOSEN EXTRA]. Keep it small and interactive. Explain the two error types and label these as validation results. Check the slider and source counts.",
        concept: { title: "What does the threshold change?", body: "A model gives each example a score. The threshold decides which scores count as signal. Moving it changes the number of signals you keep and backgrounds you accept; it does not retrain the model. The matrix should always contain the same 1,000 validation examples." },
        hint: "If site generation is taking too long, open tools/results-preview/index.html and load data/05_analytics/comparison.json. Its threshold explorer is a ready-to-use starting point. Publishing is optional; verify the audience before sharing a link.",
        checkpoint: "Your slider works on all validation examples, and you can explain one decision from the experiment.",
      },
    ],
  },
];

// These extensions are deliberately outside the core sequence and its progress count.
export const optionalWorkshopExercises: WorkshopExercise[] = [
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
    prompt: "Find the generated data/04_submissions/ JSON for my chosen model’s final test. Check the participant ID, complete validation/test IDs and file size against the Site’s upload limit. Give me the exact file path. I will upload it myself; do not change the reported values.",
    hint: "Upload only the generated result JSON, not raw data, code or model files. The server validates its contents and recomputes the metrics from its scores. Participant-reported timings are not independently rerun.",
    checkpoint: "Your final-test result is accepted by the leaderboard.",
  },
];

export const coreWorkshopExercises = workshopParts.flatMap((part) => part.exercises);
export const workshopExercises = [...coreWorkshopExercises, ...optionalWorkshopExercises];
