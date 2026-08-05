import Link from "next/link";
import { BriefView } from "@/components/BriefView";
import { SAMPLE_BRIEF } from "@/lib/sample";

// Public sample brief — what a founder's morning looks like.
// Also serves as the design reference; uses zero real data.

export default function PreviewPage() {
  return (
    <main className="mx-auto max-w-[640px] px-6 py-14">
      <BriefView brief={SAMPLE_BRIEF} greeting="Good morning." />
      <footer className="mt-16 flex items-center justify-between border-t border-line pt-5">
        <span className="font-mono text-[12px] text-faint">
          A sample brief — this is what every morning looks like.
        </span>
        <Link href="/login" className="font-mono text-[12px] text-muted hover:text-ink transition-colors">
          Get yours →
        </Link>
      </footer>
    </main>
  );
}
