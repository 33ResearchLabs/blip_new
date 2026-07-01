import {
  File as FileIcon,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Presentation,
  type LucideIcon,
} from 'lucide-react';
import { DOCUMENT_ICON_GROUPS, type DocumentIconGroup } from '../../constants';

function groupForExtension(extension: string): DocumentIconGroup {
  const ext = extension.toLowerCase();
  for (const [group, extensions] of Object.entries(DOCUMENT_ICON_GROUPS)) {
    if ((extensions as readonly string[]).includes(ext)) return group as DocumentIconGroup;
  }
  return 'generic';
}

const GROUP_ICON: Readonly<Record<DocumentIconGroup, LucideIcon>> = {
  pdf: FileText,
  word: FileText,
  sheet: FileSpreadsheet,
  slides: Presentation,
  archive: FileArchive,
  text: FileText,
  generic: FileIcon,
};

const GROUP_COLOR: Readonly<Record<DocumentIconGroup, string>> = {
  pdf: 'text-red-400',
  word: 'text-blue-400',
  sheet: 'text-green-400',
  slides: 'text-orange-400',
  archive: 'text-yellow-400',
  text: 'text-gray-300',
  generic: 'text-gray-400',
};

interface FileTypeIconProps {
  extension: string;
  className?: string;
}

/** Maps a file extension to a colour-coded lucide glyph. */
export function FileTypeIcon({ extension, className }: FileTypeIconProps) {
  const group = groupForExtension(extension);
  const Icon = GROUP_ICON[group];
  return <Icon aria-hidden className={`${GROUP_COLOR[group]} ${className ?? ''}`} />;
}
