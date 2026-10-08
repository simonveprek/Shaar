import type { Metadata } from "next";
import { Landing } from "./landing";

export const metadata: Metadata = {
  title: { absolute: "Projstalker" },
  description: "Type a name. See what the internet knows.",
};

export default function Home() {
  return <Landing />;
}
