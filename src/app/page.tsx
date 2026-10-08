import type { Metadata } from "next";
import { Landing } from "./landing";

export const metadata: Metadata = {
  title: { absolute: "Shaar" },
  description: "Beware the Spectator.",
};

export default function Home() {
  return <Landing />;
}
