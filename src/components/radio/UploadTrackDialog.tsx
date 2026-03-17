import { useState, useRef } from "react";
import { Upload, ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const GENRES = ["General", "Lo-Fi", "Pop", "Rock", "Jazz", "Classical", "Electronic", "Hip-Hop", "Country", "Ambient", "Folk", "R&B"];
const MOODS = ["Neutral", "Happy", "Chill", "Energetic", "Melancholic", "Uplifting", "Dark", "Romantic", "Epic", "Playful"];

interface UploadTrackDialogProps {
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: () => void;
  trigger: React.ReactNode;
}

export default function UploadTrackDialog({ userId, open, onOpenChange, onUploaded, trigger }: UploadTrackDialogProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [genre, setGenre] = useState("General");
  const [mood, setMood] = useState("Neutral");
  const [file, setFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);

  const handleCoverChange = (f: File | null) => {
    setCoverFile(f);
    if (f) {
      const url = URL.createObjectURL(f);
      setCoverPreview(url);
    } else {
      setCoverPreview(null);
    }
  };

  const resetForm = () => {
    setTitle("");
    setArtist("");
    setGenre("General");
    setMood("Neutral");
    setFile(null);
    setCoverFile(null);
    setCoverPreview(null);
  };

  const handleUpload = async () => {
    if (!file || !title) return;
    setUploading(true);

    const ext = file.name.split(".").pop();
    const filePath = `${userId}/${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage.from("music").upload(filePath, file);
    if (uploadError) {
      toast({ title: "Upload failed", description: uploadError.message, variant: "destructive" });
      setUploading(false);
      return;
    }

    let coverPath: string | null = null;
    if (coverFile) {
      const coverExt = coverFile.name.split(".").pop();
      coverPath = `${userId}/covers/${Date.now()}.${coverExt}`;
      const { error: coverErr } = await supabase.storage.from("music").upload(coverPath, coverFile);
      if (coverErr) {
        toast({ title: "Cover upload failed", description: coverErr.message, variant: "destructive" });
      }
    }

    const { error: dbError } = await supabase.from("music_tracks").insert({
      user_id: userId,
      title,
      artist: artist || "Unknown Artist",
      genre,
      mood,
      license_type: "Full Commercial",
      file_path: filePath,
      cover_image_path: coverPath,
    });

    if (dbError) {
      toast({ title: "Error saving track", description: dbError.message, variant: "destructive" });
    } else {
      toast({ title: "Track uploaded!", description: `"${title}" added to your library.` });
      resetForm();
      onOpenChange(false);
      onUploaded();
    }
    setUploading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Upload className="h-5 w-5" /> Upload Track</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Audio File</Label>
            <Input type="file" accept="audio/*" ref={fileInputRef} onChange={(e) => setFile(e.target.files?.[0] || null)} className="mt-1" />
          </div>

          {/* Cover Art */}
          <div>
            <Label>Cover Art (optional)</Label>
            <div className="mt-1 flex items-center gap-3">
              {coverPreview ? (
                <div className="relative h-16 w-16 rounded-md overflow-hidden border border-border">
                  <img src={coverPreview} alt="Cover" className="h-full w-full object-cover" />
                  <button onClick={() => handleCoverChange(null)} className="absolute top-0.5 right-0.5 bg-background/80 rounded-full p-0.5">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => coverInputRef.current?.click()}
                  className="h-16 w-16 rounded-md border border-dashed border-border flex items-center justify-center hover:border-primary/50 transition-colors"
                >
                  <ImagePlus className="h-5 w-5 text-muted-foreground" />
                </button>
              )}
              <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleCoverChange(e.target.files?.[0] || null)} />
              <span className="text-xs text-muted-foreground">JPG, PNG up to 2MB</span>
            </div>
          </div>

          <div>
            <Label>Title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Track title" className="mt-1" />
          </div>
          <div>
            <Label>Artist</Label>
            <Input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artist name" className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Genre</Label>
              <Select value={genre} onValueChange={setGenre}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GENRES.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Mood</Label>
              <Select value={mood} onValueChange={setMood}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MOODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">Full Commercial</Badge> License auto-applied
          </div>
          <Button onClick={handleUpload} disabled={uploading || !file || !title} className="w-full">
            {uploading ? "Uploading..." : "Upload Track"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
