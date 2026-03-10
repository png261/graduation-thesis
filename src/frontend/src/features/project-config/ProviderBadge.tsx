import { Badge } from "../../components/ui/badge";

export function ProviderBadge({ provider }: { provider: string | null | undefined }) {
  if (!provider) return <Badge variant="outline">NONE</Badge>;
  if (provider === "aws") return <Badge className="bg-amber-500/20 text-amber-200">AWS</Badge>;
  return <Badge className="bg-blue-500/20 text-blue-200">GCP</Badge>;
}
