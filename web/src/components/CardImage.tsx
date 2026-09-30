/* eslint-disable @next/next/no-img-element -- Scryfall's CDN already serves sized images;
   Scryfall's guidelines ask that card images aren't altered, so no re-encoding/cropping. */
export function CardImage({ src, alt, className = "" }: { src?: string | null; alt: string; className?: string }) {
  if (!src) {
    return (
      <div className={`grid aspect-[488/680] place-items-center rounded-[4.75%] bg-zinc-800 p-4 text-center text-sm ${className}`}>
        {alt}
      </div>
    );
  }
  return (
    <img src={src} alt={alt} loading="lazy" width={488} height={680}
      className={`aspect-[488/680] h-auto w-full rounded-[4.75%] shadow-lg shadow-black/40 ${className}`} />
  );
}
