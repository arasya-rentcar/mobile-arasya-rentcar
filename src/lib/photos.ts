import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Directory, File, Paths } from 'expo-file-system';

const MAX_SIDE = 1600;

export type PickResult = { uri: string } | { error: string } | null;

/** Resize to max 1600px on the long side and re-encode as JPEG ~0.7. */
async function shrink(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  try {
    const { width, height } = asset;
    const ctx = ImageManipulator.manipulate(asset.uri);
    if (width && height && Math.max(width, height) > MAX_SIDE) {
      ctx.resize(width >= height ? { width: MAX_SIDE } : { height: MAX_SIDE });
    }
    const image = await ctx.renderAsync();
    const saved = await image.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
    return saved.uri;
  } catch {
    return asset.uri;
  }
}

export async function takePhoto(): Promise<PickResult> {
  if (Platform.OS !== 'web') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      return { error: 'Izin kamera ditolak. Pilih foto dari galeri, atau izinkan kamera di Pengaturan HP.' };
    }
  }
  try {
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (res.canceled || !res.assets?.[0]) return null;
    return { uri: await shrink(res.assets[0]) };
  } catch {
    return { error: 'Kamera tidak bisa dibuka. Coba pilih dari galeri.' };
  }
}

export async function pickFromGallery(): Promise<PickResult> {
  try {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (res.canceled || !res.assets?.[0]) return null;
    return { uri: await shrink(res.assets[0]) };
  } catch {
    return { error: 'Galeri tidak bisa dibuka.' };
  }
}

/**
 * Moves a picked photo out of the cache folder into app storage so it survives until it is
 * uploaded (the OS may clear the cache while the driver has no signal). On web, blob: URLs do
 * not survive a reload, so the photo is converted to a data: URL instead.
 */
export async function keepPhoto(uri: string, id: string): Promise<string> {
  if (Platform.OS === 'web') {
    if (uri.startsWith('data:')) return uri;
    try {
      const blob = await (await fetch(uri)).blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    } catch {
      return uri;
    }
  }
  try {
    const dir = new Directory(Paths.document, 'pending-photos');
    if (!dir.exists) dir.create({ intermediates: true });
    const dest = new File(dir, `${id}.jpg`);
    if (dest.exists) dest.delete();
    await new File(uri).copy(dest);
    return dest.uri;
  } catch {
    return uri;
  }
}

export function deletePhoto(uri: string | null | undefined) {
  if (!uri || Platform.OS === 'web' || !uri.includes('pending-photos')) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {}
}

/** Appends the photo to a multipart form in the way each platform's fetch understands. */
export async function appendPhoto(form: FormData, uri: string, name: string) {
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    form.append('photo', blob, name);
  } else {
    form.append('photo', { uri, name, type: 'image/jpeg' } as unknown as Blob);
  }
}
