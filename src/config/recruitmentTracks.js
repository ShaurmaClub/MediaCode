/**
 * Клиентская обёртка над общим конфигом направлений (shared/recruitmentTracks.js).
 * Здесь живут только иконки; тексты направлений редактируются в shared/recruitmentTracks.js.
 */
import { Camera, Video, Film, Palette, Share2, Mic } from 'lucide-react';

export const TRACK_ICONS = {
  PHOTO: Camera,
  VIDEO: Video,
  MONTAGE: Film,
  DESIGN: Palette,
  SMM: Share2,
  CONTENT: Mic
};

import { RECRUITMENT_TRACKS as SHARED_TRACKS } from '../../shared/recruitmentTracks.js';

// Клиентское представление направлений: общие данные + иконка по типу направления
export const RECRUITMENT_TRACKS = SHARED_TRACKS.map((t) => ({ ...t, icon: TRACK_ICONS[t.type] }));

export default RECRUITMENT_TRACKS;
