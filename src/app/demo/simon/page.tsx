import type { Metadata } from "next";
import { SIMON } from "../../demos";
import { Landing } from "../../landing";

export const metadata: Metadata = {
  title: { absolute: "Shaar demo" },
  description: "The whole flow for Šimon Vepřek, staged from his public record. No searches are made.",
  robots: { index: false },
};

export default function SimonDemoPage() {
  return <Landing demo={SIMON} />;
}
