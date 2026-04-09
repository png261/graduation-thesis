import { MessagePartPrimitive, type TextMessagePartProps } from "@assistant-ui/react";

import {
  EVIDENCE_BUNDLE_SECTIONS,
  type EvidenceBundlePayload,
  parseEvidenceBundleText,
} from "./evidence-bundle";

function PlainAssistantText() {
  return (
    <p style={{ whiteSpace: "pre-line" }} className="text-[var(--da-text)]">
      <MessagePartPrimitive.Text />
      <MessagePartPrimitive.InProgress>
        <span style={{ fontFamily: "revert" }}> ●</span>
      </MessagePartPrimitive.InProgress>
    </p>
  );
}

function SectionList({ title, items }: { title: string; items: string[] }) {
  if (items.length < 1) return null;
  return (
    <section className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--da-muted)]">{title}</p>
      <ul className="space-y-1 text-sm text-[var(--da-text)]">
        {items.map((item, index) => (
          <li key={`${title}-${index}`} className="rounded-md bg-[var(--da-bg)] px-3 py-2">
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

function bundleItems(bundle: EvidenceBundlePayload, title: typeof EVIDENCE_BUNDLE_SECTIONS[number]) {
  if (title === "Changed Files") return bundle.changedFiles;
  if (title === "Validations Run") return bundle.validationsRun;
  if (title === "Pass/Fail Evidence") return bundle.passFailEvidence;
  if (title === "Unresolved Risks") return bundle.unresolvedRisks;
  return bundle.completionRationale;
}

function EvidenceBundlePanel({ bundle }: { bundle: EvidenceBundlePayload }) {
  return (
    <div className="space-y-4 rounded-xl border border-[var(--da-border)] bg-[var(--da-elevated)] p-4">
      <div>
        <p className="text-sm font-semibold text-[var(--da-text)]">Evidence Bundle</p>
        <p className="text-xs text-[var(--da-muted)]">Structured completion evidence for a substantial task.</p>
      </div>
      {EVIDENCE_BUNDLE_SECTIONS.map((section) => (
        <SectionList key={section} title={section} items={bundleItems(bundle, section)} />
      ))}
    </div>
  );
}

export function EvidenceBundleCard(props: TextMessagePartProps) {
  const parsed = parseEvidenceBundleText(props.text);
  if (!parsed) return <PlainAssistantText />;
  return <EvidenceBundlePanel bundle={parsed} />;
}

export function EvidenceBundleToolCard({ bundle }: { bundle: EvidenceBundlePayload }) {
  return <EvidenceBundlePanel bundle={bundle} />;
}
