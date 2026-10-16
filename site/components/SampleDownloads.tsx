import { Download } from "lucide-react";
import styles from "./SampleDownloads.module.css";

const files = [
  { name: "train.parquet", detail: "4,000 jets · 3.76 MB" },
  { name: "validation.parquet", detail: "1,000 jets · 2.15 MB" },
  { name: "test.parquet", detail: "1,000 jets · 2.17 MB" },
  { name: "manifest.json", detail: "Checksums and provenance · 27 KB" },
];

export function SampleDownloads() {
  return (
    <section className={styles.downloads} aria-labelledby="sample-downloads-title">
      <div className={styles.heading}>
        <h3 id="sample-downloads-title">Get the workshop sample</h3>
        <span>6,000 jets · 8.1 MB total</span>
      </div>
      <p>Download these four files from this Site.</p>
      <ul className={styles.files}>
        {files.map(file => (
          <li key={file.name}>
            <a href={`/downloads/jetclass2-v1/${file.name}`} download={file.name}>
              <span><code>{file.name}</code><small>{file.detail}</small></span>
              <Download size={17} aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
      <p>
        Keep the filenames unchanged and move all four into <code>data/01_raw/</code> in your cloned repository.
        Follow the prompts below. Python setup runs in the baseline step.
      </p>
    </section>
  );
}
