import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Directory, File, Paths } from 'expo-file-system';

/** Long side and JPEG quality of each resize attempt; the second one is tried when the first fails. */
const RESIZE_STEPS = [
  { side: 1600, compress: 0.7 },
  { side: 1024, compress: 0.5 },
];

export type PickResult = { uri: string } | { error: string } | null;

const SHRINK_FAILED = 'Foto tidak bisa diproses. Coba ambil ulang.';

/** Resize + re-encode a photo taken outside the image picker (e.g. the GPS camera). */
export async function shrinkUri(uri: string, width?: number, height?: number): Promise<string> {
  return shrink({ uri, width: width ?? 0, height: height ?? 0 } as ImagePicker.ImagePickerAsset);
}

/**
 * Resize and re-encode as JPEG so uploads stay small. If resizing fails it is retried at a smaller
 * size; the raw original is never used as a fallback (it can be many MB and would be refused by
 * the server), so this throws when both attempts fail.
 */
async function shrink(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  const { width, height } = asset;
  for (const step of RESIZE_STEPS) {
    try {
      const ctx = ImageManipulator.manipulate(asset.uri);
      if (width && height && Math.max(width, height) > step.side) {
        ctx.resize(width >= height ? { width: step.side } : { height: step.side });
      }
      const image = await ctx.renderAsync();
      const saved = await image.saveAsync({ compress: step.compress, format: SaveFormat.JPEG });
      return saved.uri;
    } catch {}
  }
  throw new Error(SHRINK_FAILED);
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
  } catch (e) {
    if (e instanceof Error && e.message === SHRINK_FAILED) return { error: SHRINK_FAILED };
    return { error: 'Kamera tidak bisa dibuka. Coba pilih dari galeri.' };
  }
}

export async function pickFromGallery(): Promise<PickResult> {
  try {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (res.canceled || !res.assets?.[0]) return null;
    return { uri: await shrink(res.assets[0]) };
  } catch (e) {
    if (e instanceof Error && e.message === SHRINK_FAILED) return { error: SHRINK_FAILED };
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

/**
 * Appends the photo to a multipart form in the way each platform's fetch understands.
 *
 * On the phone the global fetch is `expo/fetch` (Expo SDK 57). Its multipart encoder
 * (`expo/src/winter/fetch/convertFormData.ts`) does not accept React Native's `{ uri, name, type }`
 * file parts ("Unsupported FormDataPart implementation"); it reads `name`, `type` and `bytes()`
 * from the part instead. The file is read only when the request is built, so nothing is loaded
 * into memory while the item waits in the queue. `type` must stay `image/jpeg`: the API refuses
 * other types with 415.
 */
export async function appendPhoto(form: FormData, uri: string, name: string) {
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    form.append('photo', blob, name);
  } else {
    const file = new File(uri);
    if (!file.exists) throw new Error('File foto tidak ditemukan di HP. Hapus laporan ini lalu ambil foto ulang.');
    const part = { name, type: 'image/jpeg', bytes: () => file.bytes() };
    form.append('photo', part as unknown as Blob);
  }
}
