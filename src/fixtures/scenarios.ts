import type {
  AdapterSnapshots,
  Annotation,
  ArtifactMetadata,
  ArtifactVersion,
  FileNode,
  Message,
  PermissionRequest,
  PlanState,
  PlotPoint,
  ProvenanceRecord,
  RemoteJob,
  ReviewerFinding,
  SessionSnapshot,
  Track,
} from "../adapter/types";

const now = "2026-07-01T06:55:00Z";

const plotGroups = ["neuron", "muscle", "immune", "ciliated", "germline", "stem"];

function makePoints(): PlotPoint[] {
  return Array.from({ length: 132 }, (_, index) => {
    const group = plotGroups[index % plotGroups.length];
    const cluster = index % 6;
    const angle = (index * 39) % 360;
    const radius = 16 + ((index * 11) % 42);
    const centerX = [34, 68, 76, 54, 42, 60][cluster];
    const centerY = [66, 72, 35, 48, 30, 25][cluster];
    return {
      x: Math.max(5, Math.min(95, centerX + Math.cos((angle * Math.PI) / 180) * radius * 0.45)),
      y: Math.max(5, Math.min(95, centerY + Math.sin((angle * Math.PI) / 180) * radius * 0.34)),
      group,
    };
  });
}

const sessions: SessionSnapshot[] = [
  {
    sessionId: "ses_lit_review",
    projectId: "proj_cross_species",
    title: "Cross-species literature review",
    group: "active",
    status: "reviewing",
    unread: 1,
    summary: "Five retrieval tracks, reviewer found one citation conflict.",
    updatedAt: now,
  },
  {
    sessionId: "ses_scrna_sweep",
    projectId: "proj_single_cell",
    title: "scVI hyperparameter sweep",
    group: "active",
    status: "running",
    unread: 8,
    summary: "Eight remote A100 jobs are streaming logs into a notebook artifact.",
    updatedAt: "2026-07-01T06:50:00Z",
  },
  {
    sessionId: "ses_figure_review",
    projectId: "proj_cross_species",
    title: "Samosa figure callouts",
    group: "today",
    status: "idle",
    summary: "Figure annotation pass with two staged image comments.",
    updatedAt: "2026-07-01T06:20:00Z",
  },
  {
    sessionId: "ses_model_training",
    projectId: "proj_single_cell",
    title: "Samosa model training",
    group: "all",
    status: "completed",
    summary: "Checkpoint comparison and environment snapshot archived.",
    updatedAt: "2026-06-30T21:10:00Z",
  },
  {
    sessionId: "ses_benchmarking",
    projectId: "proj_protein_design",
    title: "KRAS variant atlas",
    group: "today",
    status: "completed",
    summary: "Protein structure and pathogenic variant summary.",
    updatedAt: "2026-07-01T04:05:00Z",
  },
];

const messages: Record<string, Message[]> = {
  ses_lit_review: [
    {
      messageId: "msg_lit_user_1",
      sessionId: "ses_lit_review",
      role: "user",
      parts: [
        {
          type: "text",
          text: "Write a cross-species single-cell RNA-seq integration review. Pull primary methods papers, citation counts, and recent benchmarks. Save a PDF and the source files.",
        },
      ],
      status: "completed",
      createdAt: "2026-07-01T06:40:00Z",
    },
    {
      messageId: "msg_lit_assistant_1",
      sessionId: "ses_lit_review",
      role: "assistant",
      parts: [
        { type: "text", text: "I split the work into retrieval, synthesis, evidence checking, and artifact generation." },
        { type: "plan", planId: "plan_lit_review" },
      ],
      status: "completed",
      createdAt: "2026-07-01T06:40:09Z",
    },
    {
      messageId: "msg_lit_tool_1",
      sessionId: "ses_lit_review",
      role: "tool",
      parts: [{ type: "tool", toolId: "tool_pubmed" }],
      status: "completed",
      createdAt: "2026-07-01T06:41:10Z",
    },
    {
      messageId: "msg_lit_assistant_2",
      sessionId: "ses_lit_review",
      role: "assistant",
      parts: [
        { type: "text", text: "Drafted the report and compiled a PDF. The reviewer is checking method identifiers against the execution log." },
        { type: "artifact_ref", artifactId: "art_review_pdf", versionId: "ver_pdf_2", label: "review.pdf" },
      ],
      status: "completed",
      createdAt: "2026-07-01T06:47:00Z",
    },
  ],
  ses_scrna_sweep: [
    {
      messageId: "msg_sweep_user_1",
      sessionId: "ses_scrna_sweep",
      role: "user",
      parts: [
        {
          type: "text",
          text: "Dispatch the 8-arm scVI sweep to the lab cluster and keep a live notebook attached to the agent.",
        },
      ],
      status: "completed",
      createdAt: "2026-07-01T06:31:20Z",
    },
    {
      messageId: "msg_sweep_assistant_1",
      sessionId: "ses_scrna_sweep",
      role: "assistant",
      parts: [
        { type: "text", text: "The sweep matrix is staged. I need shell and remote-job approval before dispatch." },
        { type: "permission", permissionId: "perm_remote_job" },
      ],
      status: "completed",
      createdAt: "2026-07-01T06:31:45Z",
    },
    {
      messageId: "msg_sweep_tool_1",
      sessionId: "ses_scrna_sweep",
      role: "tool",
      parts: [{ type: "tool", toolId: "tool_notebook_clean" }, { type: "remote_job", jobId: "job_scvi_sweep" }],
      status: "completed",
      createdAt: "2026-07-01T06:34:45Z",
    },
  ],
  ses_figure_review: [
    {
      messageId: "msg_fig_user_1",
      sessionId: "ses_figure_review",
      role: "user",
      parts: [
        {
          type: "text",
          text: "Open the latest Samosa figure and mark labels that are difficult to read.",
        },
      ],
      status: "completed",
      createdAt: "2026-07-01T06:12:00Z",
    },
    {
      messageId: "msg_fig_assistant_1",
      sessionId: "ses_figure_review",
      role: "assistant",
      parts: [
        { type: "text", text: "Loaded the current figure artifact. Use point annotations on the plot or code-line annotations in provenance." },
        { type: "artifact_ref", artifactId: "art_samosa_fig", versionId: "ver_fig_3", label: "samosa_fig1a.png" },
      ],
      status: "completed",
      createdAt: "2026-07-01T06:12:25Z",
    },
  ],
};

const planLit: PlanState = {
  planId: "plan_lit_review",
  sessionId: "ses_lit_review",
  title: "Evidence-backed literature synthesis",
  summary: "Retrieve sources, normalize citation evidence, write LaTeX, compile PDF, then run reviewer.",
  status: "running",
  steps: [
    { id: "step_pubmed", title: "Dispatch PubMed, bioRxiv, OpenAlex, CELLxGENE tracks", status: "completed" },
    { id: "step_synthesis", title: "Synthesize methods and benchmark matrix", status: "completed" },
    { id: "step_compile", title: "Compile LaTeX and PDF artifacts", status: "completed" },
    { id: "step_review", title: "Run citation and claim reviewer", status: "running" },
  ],
};

const planSweep: PlanState = {
  planId: "plan_sweep",
  sessionId: "ses_scrna_sweep",
  title: "Remote scVI sweep",
  summary: "Clean data, dispatch eight jobs, stream logs, collect metrics, and version notebook outputs.",
  status: "approved",
  steps: [
    { id: "step_clean", title: "Rewrite portable AnnData object", status: "completed" },
    { id: "step_dispatch", title: "Submit eight A100 jobs", status: "running" },
    { id: "step_collect", title: "Collect ELBO and integration metrics", status: "pending" },
  ],
};

const artifacts: ArtifactMetadata[] = [
  {
    id: "art_review_pdf",
    projectId: "proj_cross_species",
    sessionId: "ses_lit_review",
    kind: "pdf",
    name: "review.pdf",
    currentVersionId: "ver_pdf_2",
    mimeType: "application/pdf",
    starred: true,
    createdAt: "2026-07-01T06:45:00Z",
    updatedAt: "2026-07-01T06:48:00Z",
  },
  {
    id: "art_review_tex",
    projectId: "proj_cross_species",
    sessionId: "ses_lit_review",
    kind: "code",
    name: "review.tex",
    currentVersionId: "ver_tex_2",
    mimeType: "text/x-tex",
    starred: false,
    createdAt: "2026-07-01T06:44:00Z",
    updatedAt: "2026-07-01T06:48:00Z",
  },
  {
    id: "art_scvi_notebook",
    projectId: "proj_single_cell",
    sessionId: "ses_scrna_sweep",
    kind: "notebook",
    name: "liver-pipeline.ipynb",
    currentVersionId: "ver_nb_1",
    mimeType: "application/x-ipynb+json",
    starred: true,
    createdAt: "2026-07-01T06:34:00Z",
    updatedAt: "2026-07-01T06:50:00Z",
  },
  {
    id: "art_sweep_table",
    projectId: "proj_single_cell",
    sessionId: "ses_scrna_sweep",
    kind: "table",
    name: "scvi_sweep_matrix.csv",
    currentVersionId: "ver_sweep_table_1",
    mimeType: "text/csv",
    starred: false,
    createdAt: "2026-07-01T06:33:00Z",
    updatedAt: "2026-07-01T06:33:00Z",
  },
  {
    id: "art_samosa_fig",
    projectId: "proj_cross_species",
    sessionId: "ses_figure_review",
    kind: "figure",
    name: "samosa_fig1a.png",
    currentVersionId: "ver_fig_3",
    mimeType: "image/png",
    starred: false,
    createdAt: "2026-07-01T06:10:00Z",
    updatedAt: "2026-07-01T06:13:00Z",
  },
  {
    id: "art_fig_code",
    projectId: "proj_cross_species",
    sessionId: "ses_figure_review",
    kind: "code",
    name: "figure_callouts.py",
    currentVersionId: "ver_fig_code_1",
    mimeType: "text/x-python",
    starred: false,
    createdAt: "2026-07-01T06:11:00Z",
    updatedAt: "2026-07-01T06:11:00Z",
  },
];

const findings: ReviewerFinding[] = [
  {
    findingId: "rev_pmid_swap",
    sessionId: "ses_lit_review",
    artifactId: "art_review_pdf",
    versionId: "ver_pdf_2",
    severity: "warning",
    claim: "PMID 31178118 is assigned to both LIGER and Seurat v3 in the synthesis table.",
    evidence: "The execution log shows separate DOI lookups for LIGER and Seurat v3, but the draft table reused one identifier.",
    recommendation: "Correct the LIGER identifier and rebuild the citation table before final export.",
    status: "open",
  },
  {
    findingId: "rev_label_contrast",
    sessionId: "ses_figure_review",
    artifactId: "art_samosa_fig",
    versionId: "ver_fig_3",
    severity: "info",
    claim: "Two inset labels fall below the contrast target for projection figures.",
    evidence: "Image point annotations overlap the muscle and ciliated callouts.",
    recommendation: "Increase label halo and move legend below the plot.",
    status: "open",
  },
];

const versions: Record<string, ArtifactVersion[]> = {
  art_review_pdf: [
    {
      artifactId: "art_review_pdf",
      versionId: "ver_pdf_1",
      label: "v1 draft",
      createdAt: "2026-07-01T06:45:00Z",
      authorMessageId: "msg_lit_assistant_2",
      preview: {
        kind: "pdf",
        title: "Cross-species single-cell RNA-seq integration",
        pages: [
          {
            pageNumber: 1,
            title: "from one-to-one orthologs to protein-language-model embeddings",
            columns: [
              "Comparative single-cell transcriptomics asks whether a cell type in one species has a homolog in another, and how its expression program is conserved or rewired.",
              "Ortholog-subsetting tools dominated early integration methods, while embedding-based methods now support datasets without perfect orthology calls.",
            ],
            figureCaption: "Fifteen integration methods plotted by publication year and evidence strategy.",
          },
        ],
      },
    },
    {
      artifactId: "art_review_pdf",
      versionId: "ver_pdf_2",
      label: "v2 reviewer pass",
      createdAt: "2026-07-01T06:48:00Z",
      authorMessageId: "msg_lit_assistant_2",
      preview: {
        kind: "pdf",
        title: "Cross-species single-cell RNA-seq integration",
        pages: [
          {
            pageNumber: 1,
            title: "from ortholog tables to protein-language-model embeddings",
            columns: [
              "The evidence matrix separates orthology-based alignment, latent transfer, and embedding-first approaches. Each method row is linked back to retrieval tracks.",
              "Recent benchmarks emphasize lineage distance, missing-gene robustness, and whether integration preserves species-specific programs.",
            ],
            figureCaption: "Reviewer-marked draft; one citation mapping remains open.",
          },
        ],
      },
    },
  ],
  art_review_tex: [
    {
      artifactId: "art_review_tex",
      versionId: "ver_tex_2",
      label: "v2 source",
      createdAt: "2026-07-01T06:48:00Z",
      preview: {
        kind: "code",
        language: "latex",
        code: "\\section{Problem statement}\nComparative single-cell transcriptomics asks whether cell types can be mapped across species while preserving lineage-specific signal.\n\n\\section{Methods}\nWe compare ortholog subsetting, scVI transfer, SAMap, SATURN, and protein embedding methods.",
      },
    },
  ],
  art_scvi_notebook: [
    {
      artifactId: "art_scvi_notebook",
      versionId: "ver_nb_1",
      label: "live kernel",
      createdAt: "2026-07-01T06:50:00Z",
      preview: {
        kind: "notebook",
        kernel: { name: "Python - liver-pipeline kernel", status: "live", sharedWithAgent: true },
        cells: [
          {
            id: "cell_28",
            executionCount: 28,
            language: "python",
            status: "completed",
            source:
              "import pandas as pd\nimport numpy as np\nimport scanpy as sc\n\na = sc.read_h5ad('covid_pbmc_40k_hvg.h5ad')\nprint('loaded:', a.shape)",
            output: "loaded: (40000, 2000)\nwrote covid_pbmc_40k_hvg.h5ad",
          },
          {
            id: "cell_29",
            executionCount: 29,
            language: "python",
            status: "running",
            source:
              "for arm in sweep_matrix:\n    submit_slurm_job(arm, gpu='A100', hours=2)\nstream_remote_logs(job_group='scvi-sweep')",
            output: "dispatching arm 6/8...\nremote queue accepted lab_cluster_1187",
          },
        ],
      },
    },
  ],
  art_sweep_table: [
    {
      artifactId: "art_sweep_table",
      versionId: "ver_sweep_table_1",
      label: "8 arm matrix",
      createdAt: "2026-07-01T06:33:00Z",
      preview: {
        kind: "table",
        columns: ["arm", "n_latent", "n_layers", "label", "status"],
        rows: [
          ["1", "10", "1", "d=10 L=1 scVI COVID-PBMC", "running"],
          ["2", "10", "2", "d=10 L=2 scVI COVID-PBMC", "running"],
          ["3", "20", "1", "d=20 L=1 scVI COVID-PBMC", "running"],
          ["4", "20", "2", "d=20 L=2 scVI COVID-PBMC", "queued"],
          ["5", "30", "1", "d=30 L=1 scVI COVID-PBMC", "queued"],
          ["6", "30", "2", "d=30 L=2 scVI COVID-PBMC", "queued"],
          ["7", "50", "1", "d=50 L=1 scVI COVID-PBMC", "queued"],
          ["8", "50", "2", "d=50 L=2 scVI COVID-PBMC", "queued"],
        ],
      },
    },
  ],
  art_samosa_fig: [
    {
      artifactId: "art_samosa_fig",
      versionId: "ver_fig_3",
      label: "v3 labeled projection",
      createdAt: "2026-07-01T06:13:00Z",
      preview: {
        kind: "figure",
        title: "138 species - 5,672 cell types - one shared embedding",
        points: makePoints(),
        legend: plotGroups,
        callouts: [
          { x: 72, y: 35, label: "immune" },
          { x: 69, y: 75, label: "muscle", severity: "warning" },
          { x: 52, y: 49, label: "ciliated", severity: "warning" },
          { x: 45, y: 31, label: "stem/progenitor" },
          { x: 32, y: 66, label: "neuron" },
        ],
      },
    },
  ],
  art_fig_code: [
    {
      artifactId: "art_fig_code",
      versionId: "ver_fig_code_1",
      label: "render script",
      createdAt: "2026-07-01T06:11:00Z",
      preview: {
        kind: "code",
        language: "python",
        code:
          "apply_nature_style()\ncentroids = pd.read_csv('fig4_atlas_centroids_m138ea.csv')\nboxes_df = pd.read_csv('fig4_atlas_inset_boxes.csv')\ncallouts = pd.read_csv('fig4_atlas_callouts.csv')\n\nfor _, row in boxes_df.iterrows():\n    target = centroids[centroids.family == row.family]\n    add_inset(ax, target, row.tag)\n\nfor _, label in callouts.iterrows():\n    ax.text(label.x, label.y, label.name, path_effects=halo_thin)",
      },
    },
  ],
};

function provenanceKey(artifactId: string, versionId: string) {
  return `${artifactId}:${versionId}`;
}

const provenance: Record<string, ProvenanceRecord> = {
  [provenanceKey("art_review_pdf", "ver_pdf_2")]: {
    artifactId: "art_review_pdf",
    versionId: "ver_pdf_2",
    tabs: {
      messages: [{ messageId: "msg_lit_user_1" }, { messageId: "msg_lit_assistant_2" }],
      code: [
        {
          language: "python",
          downloadUrl: "/v1/artifacts/art_review_pdf/versions/ver_pdf_2/code/build_review.py",
          code: "papers = retrieve_sources(['PubMed', 'bioRxiv', 'OpenAlex'])\nwrite_latex(papers)\ncompile_pdf('review.tex')",
        },
      ],
      executionLog: [
        {
          stepId: "tool_pubmed",
          kind: "network",
          stdout: "24 papers loaded; 15 method rows normalized; PDF compiled",
          stderr: "",
          exitCode: 0,
          durationMs: 43120,
        },
      ],
      environment: {
        python: "3.12.4",
        packages: [
          { name: "pandas", version: "2.2.3" },
          { name: "scholarly", version: "1.7.11" },
          { name: "latexmk", version: "4.86" },
        ],
        cwd: "/projects/cross-species/review",
        git: "clean @ 4f62a7b",
        resources: "local sandbox, network allowlist: pubmed.ncbi.nlm.nih.gov, openalex.org",
      },
      review: [{ findingId: "rev_pmid_swap", severity: "warning" }],
    },
  },
  [provenanceKey("art_samosa_fig", "ver_fig_3")]: {
    artifactId: "art_samosa_fig",
    versionId: "ver_fig_3",
    tabs: {
      messages: [{ messageId: "msg_fig_user_1" }, { messageId: "msg_fig_assistant_1" }],
      code: [
        {
          language: "python",
          downloadUrl: "/v1/artifacts/art_samosa_fig/versions/ver_fig_3/code/figure_callouts.py",
          code: String(versions.art_fig_code[0].preview.kind === "code" ? versions.art_fig_code[0].preview.code : ""),
        },
      ],
      executionLog: [
        {
          stepId: "tool_fig_render",
          kind: "python",
          stdout: "Rendered projection with 5 callouts and 3 inset panels",
          stderr: "",
          exitCode: 0,
          durationMs: 5280,
        },
      ],
      environment: {
        python: "3.12.4",
        packages: [
          { name: "matplotlib", version: "3.10.1" },
          { name: "scanpy", version: "1.11.1" },
          { name: "pandas", version: "2.2.3" },
        ],
        cwd: "/projects/cross-species/figures",
        git: "dirty: labels branch",
      },
      review: [{ findingId: "rev_label_contrast", severity: "info" }],
    },
  },
  [provenanceKey("art_scvi_notebook", "ver_nb_1")]: {
    artifactId: "art_scvi_notebook",
    versionId: "ver_nb_1",
    tabs: {
      messages: [{ messageId: "msg_sweep_user_1" }, { messageId: "msg_sweep_tool_1" }],
      code: [
        {
          language: "python",
          downloadUrl: "/v1/artifacts/art_scvi_notebook/versions/ver_nb_1/code/notebook.py",
          code: "clean = ad.AnnData(X=sp.csr_matrix(a.layers['counts']))\nclean.write_h5ad('covid_pbmc_40k_hvg.h5ad')\nsubmit_scvi_sweep(matrix)",
        },
      ],
      executionLog: [
        {
          stepId: "tool_notebook_clean",
          kind: "python",
          stdout: "wrote covid_pbmc_40k_hvg.h5ad",
          stderr: "",
          exitCode: 0,
          durationMs: 9100,
        },
      ],
      environment: {
        python: "3.12.4",
        packages: [
          { name: "scanpy", version: "1.11.1" },
          { name: "scvi-tools", version: "1.3.1" },
          { name: "anndata", version: "0.11.4" },
        ],
        cwd: "/projects/single-cell/sweep",
        resources: "remote: lab_cluster A100 queue",
      },
      review: [],
    },
  },
};

const permissions: PermissionRequest[] = [
  {
    id: "perm_remote_job",
    sessionId: "ses_scrna_sweep",
    type: "remote_job",
    title: "Submit remote A100 jobs",
    summary: "Dispatch eight scVI training jobs to lab_cluster.",
    details: { queue: "lab_cluster", gpu: "A100", jobs: 8, walltime: "02:00:00" },
    scopes: ["once", "conversation", "project", "global"],
    recommendedScope: "conversation",
    risk: "medium",
    status: "pending",
    createdAt: "2026-07-01T06:31:44Z",
  },
  {
    id: "perm_network_pubmed",
    sessionId: "ses_lit_review",
    type: "network_host",
    title: "Access literature hosts",
    summary: "Use PubMed, bioRxiv, OpenAlex, and CELLxGENE Discover during retrieval.",
    details: { hosts: "pubmed.ncbi.nlm.nih.gov, biorxiv.org, openalex.org, cellxgene.cziscience.com" },
    scopes: ["once", "conversation", "project", "global"],
    recommendedScope: "project",
    risk: "low",
    status: "approved",
    createdAt: "2026-07-01T06:40:20Z",
  },
  {
    id: "perm_shell_install",
    sessionId: "ses_figure_review",
    type: "install_package",
    title: "Install plotting dependency",
    summary: "Install adjustText into the project sandbox for label collision cleanup.",
    details: { command: "pip install adjustText", cwd: "/projects/cross-species/figures" },
    scopes: ["once", "conversation", "project"],
    recommendedScope: "once",
    risk: "medium",
    status: "pending",
    createdAt: "2026-07-01T06:13:30Z",
  },
];

const annotations: Annotation[] = [
  {
    annotationId: "ann_label_muscle",
    artifactId: "art_samosa_fig",
    versionId: "ver_fig_3",
    sessionId: "ses_figure_review",
    target: { type: "image_point", x: 69, y: 75 },
    note: "This label is hard to read against dense points.",
    status: "staged",
    createdAt: "2026-07-01T06:14:00Z",
  },
];

const tracks: Record<string, Track[]> = {
  ses_lit_review: [
    {
      trackId: "track_pubmed",
      sessionId: "ses_lit_review",
      title: "PubMed primary methods",
      status: "completed",
      messages: ["24 papers", "15 methods", "1 duplicate identifier flagged"],
      progress: 100,
    },
    {
      trackId: "track_openalex",
      sessionId: "ses_lit_review",
      title: "OpenAlex citation counts",
      status: "completed",
      messages: ["citation counts loaded", "top-cited rows normalized"],
      progress: 100,
    },
    {
      trackId: "track_cellxgene",
      sessionId: "ses_lit_review",
      title: "CELLxGENE atlas inventory",
      status: "completed",
      messages: ["multi-species datasets indexed"],
      progress: 100,
    },
  ],
  ses_scrna_sweep: [
    {
      trackId: "track_remote_logs",
      sessionId: "ses_scrna_sweep",
      title: "Remote log stream",
      status: "running",
      messages: ["8 jobs accepted", "6 jobs running", "2 jobs queued"],
      progress: 64,
    },
  ],
  ses_figure_review: [],
};

const jobs: Record<string, RemoteJob[]> = {
  ses_scrna_sweep: [
    {
      jobId: "job_scvi_sweep",
      sessionId: "ses_scrna_sweep",
      title: "8-arm scVI sweep",
      status: "running",
      logs: [
        "lab_cluster d=10 L=1 running 16m 2s",
        "lab_cluster d=10 L=2 running 15m 42s",
        "lab_cluster d=20 L=1 running 15m 19s",
      ],
      artifactIds: ["art_scvi_notebook", "art_sweep_table"],
    },
  ],
};

const fileTree: FileNode[] = [
  {
    path: "/projects/cross-species",
    name: "cross-species",
    type: "folder",
    children: [
      { path: "/projects/cross-species/review/review.tex", name: "review.tex", type: "file" },
      { path: "/projects/cross-species/figures/figure_callouts.py", name: "figure_callouts.py", type: "file" },
      { path: "/projects/cross-species/figures/fig4_atlas_callouts.csv", name: "fig4_atlas_callouts.csv", type: "file" },
    ],
  },
  {
    path: "/projects/single-cell",
    name: "single-cell",
    type: "folder",
    children: [
      { path: "/projects/single-cell/sweep/liver-pipeline.ipynb", name: "liver-pipeline.ipynb", type: "file" },
      { path: "/projects/single-cell/sweep/scvi_sweep_matrix.csv", name: "scvi_sweep_matrix.csv", type: "file" },
    ],
  },
];

export const snapshots: AdapterSnapshots = {
  projects: [
    {
      projectId: "proj_cross_species",
      name: "Cross-species Samosa",
      description: "Comparative single-cell analysis, figures, and literature synthesis.",
      current: true,
      rootPath: "/projects/cross-species",
      updatedAt: now,
    },
    {
      projectId: "proj_single_cell",
      name: "scRNA-seq",
      description: "Remote sweeps, notebooks, and integration benchmarks.",
      rootPath: "/projects/single-cell",
      updatedAt: "2026-07-01T06:50:00Z",
    },
    {
      projectId: "proj_protein_design",
      name: "Protein atlas",
      description: "Protein structure and variant interpretation workbench.",
      rootPath: "/projects/protein",
      updatedAt: "2026-07-01T04:05:00Z",
    },
  ],
  sessions,
  messages,
  artifacts: {
    ses_lit_review: artifacts.filter((artifact) => artifact.sessionId === "ses_lit_review"),
    ses_scrna_sweep: artifacts.filter((artifact) => artifact.sessionId === "ses_scrna_sweep"),
    ses_figure_review: artifacts.filter((artifact) => artifact.sessionId === "ses_figure_review"),
  },
  versions,
  provenance,
  permissions,
  annotations,
  plans: {
    ses_lit_review: planLit,
    ses_scrna_sweep: planSweep,
  },
  tracks,
  jobs,
  settings: {
    theme: "bio-lab-glass",
    defaultProjectId: "proj_cross_species",
    notifications: true,
    rightPanelBehavior: "pin",
    networkAllowlist: ["pubmed.ncbi.nlm.nih.gov", "openalex.org", "cellxgene.cziscience.com"],
    memoryEnabled: true,
    storageRetentionDays: 90,
  },
  connectors: [
    { id: "conn_pubmed", name: "PubMed", status: "connected", description: "Literature retrieval and metadata normalization." },
    { id: "conn_openalex", name: "OpenAlex", status: "connected", description: "Citation counts and work graph lookup." },
    { id: "conn_cluster", name: "Lab cluster", status: "available", description: "Remote SLURM dispatch over SSH." },
  ],
  skills: [
    { id: "skill_lit_review", name: "Literature synthesis", enabled: true, description: "Retrieve, deduplicate, and cite scientific papers." },
    { id: "skill_rjob_ops", name: "Remote job ops", enabled: true, description: "Submit jobs, stream logs, and collect remote outputs." },
    { id: "skill_figure_review", name: "Figure reviewer", enabled: true, description: "Find contrast, label, and provenance issues in generated figures." },
  ],
  specialists: [
    { id: "spec_reviewer", name: "Reviewer", policy: "Always run before final artifacts", enabled: true },
    { id: "spec_notebook", name: "Notebook operator", policy: "Use live kernel for notebook artifacts", enabled: true },
    { id: "spec_remote", name: "Remote compute", policy: "Ask before dispatching jobs", enabled: true },
  ],
  files: fileTree,
};

export const toolEvents = [
  {
    toolId: "tool_pubmed",
    sessionId: "ses_lit_review",
    kind: "network" as const,
    title: "Dispatching PubMed, bioRxiv, OpenAlex, CELLxGENE sub-agents",
    code: "retrieve_sources(['PubMed', 'bioRxiv', 'OpenAlex', 'CELLxGENE'])",
    stdout: "24 papers, 15 methods, 6 species-pair benchmarks loaded",
    stderr: "",
    exitCode: 0,
    durationMs: 43120,
    status: "completed" as const,
    createdAt: "2026-07-01T06:41:10Z",
  },
  {
    toolId: "tool_notebook_clean",
    sessionId: "ses_scrna_sweep",
    kind: "python" as const,
    title: "Rewrite portable AnnData object",
    code: "clean = ad.AnnData(X=sp.csr_matrix(a.layers['counts']))\nclean.write_h5ad('covid_pbmc_40k_hvg.h5ad')",
    stdout: "wrote covid_pbmc_40k_hvg.h5ad",
    stderr: "",
    exitCode: 0,
    durationMs: 9100,
    status: "completed" as const,
    createdAt: "2026-07-01T06:34:45Z",
  },
];

export const reviewerFindings = findings;
