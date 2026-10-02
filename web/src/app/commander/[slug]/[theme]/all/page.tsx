import { ThemeView, themeMetadata } from "../ThemeView";

export const revalidate = 3600;
export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; theme: string }>;
}) {
  const { slug, theme } = await params;
  return themeMetadata(slug, theme);
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; theme: string }>;
}) {
  const { slug, theme } = await params;
  return <ThemeView slug={slug} themeId={theme} all />;
}
