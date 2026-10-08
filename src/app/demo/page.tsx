import type { Metadata } from "next";
import { MARA } from "../demos";
import { Landing } from "../landing";

export const metadata: Metadata = {
  title: { absolute: "Shaar demo" },
  description: "The whole flow with a fictional subject. No searches are made.",
};

/** The full flow with a fictional subject and no API calls. See DEMO_* in landing.tsx. */
export default function DemoPage() {
  return <Landing demo={MARA} />;
}
