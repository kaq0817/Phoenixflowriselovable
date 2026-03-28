import { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Radio as RadioIcon, Music, Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, Trash2, Shuffle, Repeat, Plus, Layers
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useStorageUsage } from "@/hooks/useStorageUsage";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import StorageIndicator from "@/components/radio/StorageIndicator";
import UploadTrackDialog from "@/components/radio/UploadTrackDialog";
import BulkUploadDialog from "@/components/radio/BulkUploadDialog";

interface Track {
  id: string;
  title: string;
  artist: string;
  genre: string;
  mood: string;
  niche: string | null;
  duration_seconds: number | null;
  license_type: string;
  file_path: string;
  cover_image_path: string | null;
  created_at: string;
}

export default function RadioPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tracks, setTracks] = useState<Track[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(80);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isShuffled, setIsShuffled] = useState(false);
  const [isRepeating, setIsRepeating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);

  const currentTrack = currentTrackIndex >= 0 ? tracks[currentTrackIndex] : null;
  const storage = useStorageUsage(user?.id, "music");
  const isAdmin = useIsAdmin(user?.id);

  const getPublicUrl = (filePath: string) => {
    const { data } = supabase.storage.from("music").getPublicUrl(filePath);
    return data.publicUrl;
  };

  const fetchTracks = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("music_tracks")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      toast({ title: "Error loading tracks", description: error.message, variant: "destructive" });
    } else {
      setTracks(data || []);
    }
    setLoading(false);
  }, [user, toast]);

  useEffect(() => { fetchTracks(); }, [fetchTracks]);

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDurationChange = () => setDuration(audio.duration || 0);
    const onEnded = () => {
      if (isRepeating) {
        audio.currentTime = 0;
        audio.play();
      } else {
        playNext();
      }
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("ended", onEnded);
    };
  }, [isRepeating, playNext]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume / 100;
    }
  }, [volume, isMuted]);

  const playTrack = useCallback((index: number) => {
    setCurrentTrackIndex(index);
    setIsPlaying(true);
    setTimeout(() => audioRef.current?.play(), 50);
  }, []);

  const togglePlay = () => {
    if (!audioRef.current || currentTrackIndex < 0) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const playNext = useCallback(() => {
    if (tracks.length === 0) return;
    const next = isShuffled
      ? Math.floor(Math.random() * tracks.length)
      : (currentTrackIndex + 1) % tracks.length;
    playTrack(next);
  }, [currentTrackIndex, isShuffled, playTrack, tracks.length]);

  const playPrev = useCallback(() => {
    if (tracks.length === 0) return;
    const prev = currentTrackIndex <= 0 ? tracks.length - 1 : currentTrackIndex - 1;
    playTrack(prev);
  }, [currentTrackIndex, playTrack, tracks.length]);

  const seek = (value: number[]) => {
    if (audioRef.current) {
      audioRef.current.currentTime = value[0];
      setCurrentTime(value[0]);
    }
  };

  const formatTime = (s: number) => {
    if (!s || isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const handleRefresh = () => {
    fetchTracks();
    storage.refresh();
  };

  const deleteTrack = async (track: Track) => {
    const filesToRemove = [track.file_path];
    if (track.cover_image_path) filesToRemove.push(track.cover_image_path);
    await supabase.storage.from("music").remove(filesToRemove);
    await supabase.from("music_tracks").delete().eq("id", track.id);
    if (currentTrack?.id === track.id) {
      setCurrentTrackIndex(-1);
      setIsPlaying(false);
    }
    handleRefresh();
    toast({ title: "Track deleted" });
  };

  const getCoverUrl = (path: string | null) => {
    if (!path) return null;
    const { data } = supabase.storage.from("music").getPublicUrl(path);
    return data.publicUrl;
  };

  const currentCoverUrl = currentTrack ? getCoverUrl(currentTrack.cover_image_path) : null;

  return (
    <div className="space-y-6">
      {currentTrack && (
        <audio ref={audioRef} src={getPublicUrl(currentTrack.file_path)} preload="auto" />
      )}

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <RadioIcon className="h-6 w-6 text-primary" /> My Radio
          </h1>
          <p className="text-muted-foreground mt-1">Your personal music library & player.</p>
        </div>
        <div className="flex gap-2">
          <BulkUploadDialog
            userId={user?.id || ""}
            open={bulkDialogOpen}
            onOpenChange={setBulkDialogOpen}
            onUploaded={handleRefresh}
            trigger={<Button variant="outline" className="gap-2"><Layers className="h-4 w-4" /> Bulk Upload</Button>}
          />
          <UploadTrackDialog
            userId={user?.id || ""}
            open={uploadDialogOpen}
            onOpenChange={setUploadDialogOpen}
            onUploaded={handleRefresh}
            trigger={<Button className="gap-2"><Plus className="h-4 w-4" /> Add Track</Button>}
          />
        </div>
      </motion.div>

      {isAdmin && (
        <StorageIndicator totalBytes={storage.totalBytes} fileCount={storage.fileCount} loading={storage.loading} />
      )}

      {/* Player */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <Card className="bg-card/50 border-border/30">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4">
              {currentCoverUrl ? (
                <img src={currentCoverUrl} alt={currentTrack?.title} className="h-20 w-20 rounded-xl object-cover shadow-md" />
              ) : (
                <div className="h-20 w-20 rounded-xl gradient-phoenix flex items-center justify-center">
                  <Music className="h-10 w-10 text-primary-foreground" />
                </div>
              )}
              <div className="text-center">
                <h3 className="font-semibold text-lg">{currentTrack?.title || "No track selected"}</h3>
                <p className="text-sm text-muted-foreground">{currentTrack?.artist || "Pick a song to play"}</p>
                {currentTrack && (
                  <div className="flex gap-1 justify-center mt-1">
                    <Badge variant="outline" className="text-xs">{currentTrack.genre}</Badge>
                    <Badge variant="outline" className="text-xs">{currentTrack.mood}</Badge>
                  </div>
                )}
              </div>

              {/* Seek bar */}
              <div className="w-full max-w-md flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-10 text-right">{formatTime(currentTime)}</span>
                <Slider
                  value={[currentTime]}
                  max={duration || 100}
                  step={1}
                  onValueChange={seek}
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground w-10">{formatTime(duration)}</span>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="icon" onClick={() => setIsShuffled(!isShuffled)} className={isShuffled ? "text-primary" : ""}>
                  <Shuffle className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={playPrev}><SkipBack className="h-5 w-5" /></Button>
                <Button size="icon" className="h-12 w-12 rounded-full" onClick={togglePlay} disabled={tracks.length === 0}>
                  {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 ml-0.5" />}
                </Button>
                <Button variant="ghost" size="icon" onClick={playNext}><SkipForward className="h-5 w-5" /></Button>
                <Button variant="ghost" size="icon" onClick={() => setIsRepeating(!isRepeating)} className={isRepeating ? "text-primary" : ""}>
                  <Repeat className="h-4 w-4" />
                </Button>
              </div>

              {/* Volume */}
              <div className="flex items-center gap-2 w-full max-w-[200px]">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsMuted(!isMuted)}>
                  {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </Button>
                <Slider value={[isMuted ? 0 : volume]} max={100} step={1} onValueChange={(v) => { setVolume(v[0]); setIsMuted(false); }} />
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* New License Note Card */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
        <Card className="bg-card/50 border-border/30">
          <CardContent className="p-4 text-sm text-muted-foreground">
            <p className="font-semibold text-primary mb-1">License Information:</p>
            <p>Use of up to 8 seconds in ads created through Phoenix Flow. No full-track download, redistribution, resale, sublicensing, or standalone publishing rights granted.</p>
          </CardContent>
        </Card>
      </motion.div>


      {/* Track List */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <Card className="bg-card/50 border-border/30">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Music className="h-4 w-4 text-primary" /> Library ({tracks.length} tracks)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground text-center py-8">Loading tracks...</p>
            ) : tracks.length === 0 ? (
              <div className="text-center py-8">
                <Music className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground">No tracks yet. Upload your first song!</p>
              </div>
            ) : (
              <div className="space-y-1">
                {tracks.map((track, i) => (
                  <div
                    key={track.id}
                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors hover:bg-accent/50 ${currentTrackIndex === i ? "bg-primary/10 border border-primary/20" : ""}`}
                    onClick={() => playTrack(i)}
                  >
                    {getCoverUrl(track.cover_image_path) ? (
                      <div className="h-8 w-8 rounded overflow-hidden shrink-0 relative">
                        <img src={getCoverUrl(track.cover_image_path)!} alt="" className="h-full w-full object-cover" />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                          {currentTrackIndex === i && isPlaying ? (
                            <Pause className="h-3.5 w-3.5 text-white" />
                          ) : (
                            <Play className="h-3.5 w-3.5 text-white ml-0.5" />
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="h-8 w-8 rounded flex items-center justify-center bg-primary/10 shrink-0">
                        {currentTrackIndex === i && isPlaying ? (
                          <Pause className="h-4 w-4 text-primary" />
                        ) : (
                          <Play className="h-4 w-4 text-primary ml-0.5" />
                        )}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{track.title}</p>
                      <p className="text-xs text-muted-foreground truncate">{track.artist}</p>
                    </div>
                    <Badge variant="outline" className="text-xs hidden sm:inline-flex">{track.genre}</Badge>
                    {/* Removed license badge to avoid implying commercial rights for listening */}
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={(e) => { e.stopPropagation(); deleteTrack(track); }}>
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
