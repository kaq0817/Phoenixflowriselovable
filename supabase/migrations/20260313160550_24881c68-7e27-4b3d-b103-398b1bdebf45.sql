
-- Create storage bucket for music files
INSERT INTO storage.buckets (id, name, public) VALUES ('music', 'music', true);

-- Allow authenticated users to upload music
CREATE POLICY "Users can upload music" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'music' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Allow anyone to read music (public bucket)
CREATE POLICY "Public read music" ON storage.objects FOR SELECT USING (bucket_id = 'music');

-- Allow users to delete their own music
CREATE POLICY "Users can delete own music" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'music' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Create music tracks metadata table
CREATE TABLE public.music_tracks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  artist TEXT DEFAULT 'Unknown Artist',
  genre TEXT DEFAULT 'General',
  mood TEXT DEFAULT 'Neutral',
  niche TEXT,
  duration_seconds INTEGER,
  license_type TEXT NOT NULL DEFAULT 'Full Commercial',
  license_holder TEXT,
  file_path TEXT NOT NULL,
  cover_image_path TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.music_tracks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own tracks" ON public.music_tracks FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can read own tracks" ON public.music_tracks FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can update own tracks" ON public.music_tracks FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own tracks" ON public.music_tracks FOR DELETE TO authenticated USING (auth.uid() = user_id);
