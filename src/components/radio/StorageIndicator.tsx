import { HardDrive } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface StorageIndicatorProps {
  totalBytes: number;
  fileCount: number;
  loading: boolean;
  maxBytes?: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export default function StorageIndicator({
  totalBytes,
  fileCount,
  loading,
  maxBytes = 1024 * 1024 * 1024, // 1GB default
}: StorageIndicatorProps) {
  const percent = Math.min((totalBytes / maxBytes) * 100, 100);

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-muted/50 border border-border/30">
      <HardDrive className="h-4 w-4 text-muted-foreground shrink-0" />
      {loading ? (
        <span className="text-xs text-muted-foreground">Calculating…</span>
      ) : (
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {fileCount} file{fileCount !== 1 ? "s" : ""} · {formatBytes(totalBytes)}
            </span>
            <span className="text-muted-foreground">{formatBytes(maxBytes)}</span>
          </div>
          <Progress value={percent} className="h-1.5" />
        </div>
      )}
    </div>
  );
}
