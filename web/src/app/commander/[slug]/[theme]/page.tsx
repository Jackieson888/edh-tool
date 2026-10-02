import { ThemeView, themeMetadata } from "./ThemeView";

// Rendered on first visit, then cached; the catalog only changes when the loader runs.
export const revalidate = 3600;
export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: PageProps<"/commander/[slug]/[theme]">) {
  const { slug, theme } = await params;
  return themeMetadata(slug, theme);
}

export default async function ThemePage({ params }: PageProps<"/commander/[slug]/[theme]">) {
  const { slug, theme } = await params;
  return <ThemeView slug={slug} themeId={theme} />;
}
