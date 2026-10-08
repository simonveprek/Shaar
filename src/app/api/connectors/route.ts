import { listConnectors } from "@/connectors";

/** Available platforms for the frontend's "add a source" form. */
export async function GET() {
  return Response.json({ connectors: listConnectors() });
}
