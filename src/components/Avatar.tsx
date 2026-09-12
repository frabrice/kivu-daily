import { initials, avatarColor } from '../lib/utils';

interface AvatarProps {
  name: string;
  url?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizes = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-14 h-14 text-lg',
  xl: 'w-20 h-20 text-2xl',
};

export default function Avatar({ name, url, size = 'md' }: AvatarProps) {
  if (url) {
    return <img src={url} alt={name} className={`${sizes[size]} rounded-full object-cover`} />;
  }
  return (
    <div
      className={`${sizes[size]} ${avatarColor(name)} rounded-full flex items-center justify-center font-semibold text-white shrink-0`}
    >
      {initials(name)}
    </div>
  );
}
