import { useState, useRef } from "react";
import { Upload, X, Music, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const GENRES = ["General", "Lo-Fi", "Pop", "Rock", "Jazz", "Classical", "Electronic", "Hip-Hop", "Country", "Ambient", "Folk", "R&B"];
const MOODS = ["Neutral", "Happy", "Chill", "Energetic", "Melancholic", "Uplifting", "Dark", "Romantic", "Epic", "Playful"];

interface PendingTrack {
  file: File;
  title: string;
  artist: string;
  genre: string;
  mood: string;
  coverFile: File | null;
  coverPreview: string | null;
}

interface BulkUploadDialogProps {
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: () => void;
  trigger: React.ReactNode;
}

export default function BulkUploadDialog({ userId, open, onOpenChange, onUploaded, trigger }: BulkUploadDialogProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pendingTracks, setPendingTracks] = useState<PendingTrack[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  // Shared defaults
  const [sharedArtist, setSharedArtist] = useState("");
  const [sharedGenre, setSharedGenre] = useState("General");
  const [sharedMood, setSharedMood] = useState("Neutral");

  const handleFilesSelected = (files: FileList | null) => {
    if (!files) return;
    const newTracks: PendingTrack[] = Array.from(files).map(f => ({
      file: f,
      title: f.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " "),
      artist: sharedArtist,
      genre: sharedGenre,
      mood: sharedMood,
      coverFile: null,
      coverPreview: null,
    }));
    setPendingTracks(prev => [...prev, ...newTracks]);
  };

  const updateTrack = (index: number, updates: Partial<PendingTrack>) => {
    setPendingTracks(prev => prev.map((t, i) => i === index ? { ...t, ...updates } : t));
  };

  const handleCoverForTrack = (index: number, file: File | null) => {
    if (file) {
      const url = URL.createObjectURL(file);
      updateTrack(index, { coverFile: file, coverPreview: url });
    } else {
      updateTrack(index, { coverFile: null, coverPreview: null });
    }
  };

  const removeTrack = (index: number) => {
    setPendingTracks(prev => prev.filter((_, i) => i !== index));
  };

  const applySharedToAll = () => {
    setPendingTracks(prev => prev.map(t => ({
      ...t,
      artist: sharedArtist || t.artist,
      genre: sharedGenre,
      mood: sharedMood,
    })));
  };

  const handleBulkUpload = async () => {
    if (pendingTracks.length === 0) return;
    setUploading(true);
    setProgress(0);

    let uploaded = 0;
    for (const track of pendingTracks) {
      const ext = track.file.name.split(".").pop();
      const filePath = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;

      const { error: uploadErr } = await supabase.storage.from("music").upload(filePath, track.file);
      if (uploadErr) {
        toast({ title: `Failed: ${track.title}`, description: uploadErr.message, variant: "destructive" });
        continue;
      }

      let coverPath: string | null = null;
      if (track.coverFile) {
        const coverExt = track.coverFile.name.split(".").pop();
        coverPath = `${userId}/covers/${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${coverExt}`;
        await supabase.storage.from("music").upload(coverPath, track.coverFile);
      }

      await supabase.from("music_tracks").insert({
        user_id: userId,
        title: track.title,
        artist: track.artist || "Unknown Artist",
        genre: track.genre,
        mood: track.mood,
        license_type: "Full Commercial",
        file_path: filePath,
        cover_image_path: coverPath,
      });

      uploaded++;
      setProgress(Math.round((uploaded / pendingTracks.length) * 100));
    }

    toast({ title: "Bulk upload complete", description: `${uploaded} of ${pendingTracks.length} tracks uploaded.` });
    setPendingTracks([]);
    setProgress(0);
    onOpenChange(false);
    onUploaded();
    setUploading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Upload className="h-5 w-5" /> Bulk Upload</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 flex-1 min-h-0">
          {/* File picker */}
          <div>
            <Button variant="outline" className="w-full gap-2" onClick={() => fileInputRef.current?.click()}>
              <Music className="h-4 w-4" /> Select Audio Files
            </Button>
            <input ref={fileInputRef} type="file" accept="audio/*" multiple className="hidden" onChange={(e) => handleFilesSelected(e.target.files)} />
          </div>

          {/* Shared defaults */}
          {pendingTracks.length > 0 && (
            <div className="rounded-lg border border-border p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Apply to all tracks:</p>
              <div className="grid grid-cols-3 gap-2">
                <Input placeholder="Shared artist" value={sharedArtist} onChange={(e) => setSharedArtist(e.target.value)} className="text-sm" />
                <Select value={sharedGenre} onValueChange={setSharedGenre}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {GENRES.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={sharedMood} onValueChange={setSharedMood}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MOODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="secondary" size="sm" onClick={applySharedToAll}>Apply to All</Button>
            </div>
          )}

          {/* Track list */}
          <ScrollArea className="max-h-[340px]">
            <div className="space-y-2 pr-3">
              {pendingTracks.map((track, i) => (
                <TrackRow key={i} track={track} index={i} onUpdate={updateTrack} onRemove={removeTrack} onCoverChange={handleCoverForTrack} />
              ))}
            </div>
          </ScrollArea>

          {/* Upload button */}
          {pendingTracks.length > 0 && (
            <div className="space-y-2">
              {uploading && (
                <div className="w-full bg-secondary rounded-full h-2">
                  <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{pendingTracks.length} track{pendingTracks.length !== 1 ? "s" : ""} queued</span>
                <Button onClick={handleBulkUpload} disabled={uploading} className="gap-2">
                  {uploading ? `Uploading ${progress}%...` : `Upload ${pendingTracks.length} Tracks`}
                </Button>
              </div>
            </div>
          )}

          {pendingTracks.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">Select audio files to get started.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TrackRow({ track, index, onUpdate, onRemove, onCoverChange }: {
  track: PendingTrack;
  index: number;
  onUpdate: (i: number, u: Partial<PendingTrack>) => void;
  onRemove: (i: number) => void;
  onCoverChange: (i: number, f: File | null) => void;
}) {
  const coverRef = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <div className="flex items-center gap-2">
        {/* Cover art thumbnail */}
        {track.coverPreview ? (
          <div className="relative h-10 w-10 rounded overflow-hidden border border-border shrink-0">
            <img src={track.coverPreview} alt="" className="h-full w-full object-cover" />
            <button onClick={() => onCoverChange(index, null)} className="absolute top-0 right-0 bg-background/80 rounded-full p-0.5">
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        ) : (
          <button onClick={() => coverRef.current?.click()} className="h-10 w-10 rounded border border-dashed border-border flex items-center justify-center hover:border-primary/50 shrink-0">
            <ImagePlus className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
        <input ref={coverRef} type="file" accept="image/*" className="hidden" onChange={(e) => onCoverChange(index, e.target.files?.[0] || null)} />

        <div className="flex-1 min-w-0">
          <Input value={track.title} onChange={(e) => onUpdate(index, { title: e.target.value })} placeholder="Title" className="text-sm h-8" />
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => onRemove(index)}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Input value={track.artist} onChange={(e) => onUpdate(index, { artist: e.target.value })} placeholder="Artist" className="text-sm h-8" />
        <Select value={track.genre} onValueChange={(v) => onUpdate(index, { genre: v })}>
          <SelectTrigger className="text-sm h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            {GENRES.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={track.mood} onValueChange={(v) => onUpdate(index, { mood: v })}>
          <SelectTrigger className="text-sm h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MOODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs text-muted-foreground truncate">{track.file.name} • <Badge variant="outline" className="text-xs">Full Commercial</Badge></p>
    </div>
  );
}
