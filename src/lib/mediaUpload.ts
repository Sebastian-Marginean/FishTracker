import { supabase } from './supabase';

interface UploadImageOptions {
  bucket: string;
  folder: string;
  uri: string;
  userId?: string;
}

function getFileExtension(uri: string) {
  const match = uri.toLowerCase().match(/\.([a-z0-9]+)(?:\?|$)/);
  const extension = match?.[1] ?? 'jpg';

  return extension === 'jpeg' ? 'jpg' : extension;
}

function getContentType(extension: string) {
  switch (extension) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    default:
      return 'image/jpeg';
  }
}

export async function uploadImageToSupabase({ bucket, folder, uri, userId }: UploadImageOptions) {
  const extension = getFileExtension(uri);
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
  const filePath = `${folder}/${userId ?? 'anonymous'}/${fileName}`;

  const response = await fetch(uri);

  if (!response.ok) {
    throw new Error('Could not read the selected image from the device');
  }

  const fileData = await response.arrayBuffer();

  const { error } = await supabase.storage.from(bucket).upload(filePath, fileData, {
    contentType: getContentType(extension),
    upsert: false,
  });

  if (error) {
    throw new Error(error.message);
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);

  if (!data.publicUrl) {
    throw new Error('Could not obtain the public image URL');
  }

  return data.publicUrl;
}