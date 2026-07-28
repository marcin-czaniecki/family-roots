import type { Node } from "@xyflow/react";
import { toBlob, toSvg } from "html-to-image";
import { PERSON_H, PERSON_W, RELATION_SIZE } from "./genealogyLayout";

const EXPORT_PADDING = 120;
const MAX_EXPORT_DIMENSION = 16_000;
const MAX_EXPORT_PIXELS = 48_000_000;
const EXPORT_BACKGROUNDS = {
  screen: "#f3efe8",
  print: "#ffffff",
} as const;

export type GenealogyExportVariant = keyof typeof EXPORT_BACKGROUNDS;

type TreeBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function nodeSize(node: Node) {
  const fallback = node.type === "person" ? { width: PERSON_W, height: PERSON_H } : { width: RELATION_SIZE, height: RELATION_SIZE };
  return {
    width: node.measured?.width ?? node.width ?? fallback.width,
    height: node.measured?.height ?? node.height ?? fallback.height,
  };
}

function getTreeBounds(nodes: Node[]): TreeBounds | null {
  const visibleNodes = nodes.filter((node) => !node.hidden);
  if (visibleNodes.length === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of visibleNodes) {
    const size = nodeSize(node);
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + size.width);
    maxY = Math.max(maxY, node.position.y + size.height);
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function exportScale(width: number, height: number) {
  const dimensionScale = Math.min(1, MAX_EXPORT_DIMENSION / width, MAX_EXPORT_DIMENSION / height);
  const pixelScale = Math.min(1, Math.sqrt(MAX_EXPORT_PIXELS / (width * height)));
  return Math.min(dimensionScale, pixelScale);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = filename;
  link.href = url;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function svgDataUrlToBlob(dataUrl: string) {
  const contentStart = dataUrl.indexOf(",");
  if (contentStart < 0) throw new Error("Nie udało się odczytać obrazu SVG.");
  const svg = decodeURIComponent(dataUrl.slice(contentStart + 1));
  return new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
}

function exportFilter(node: HTMLElement) {
  return !(node instanceof Element && (node.matches("button") || node.matches(".react-flow__handle")));
}

export async function downloadGenealogyExport(viewport: HTMLElement, nodes: Node[], variant: GenealogyExportVariant = "screen") {
  const bounds = getTreeBounds(nodes);
  if (!bounds) throw new Error("Drzewo nie zawiera elementów do zapisania.");

  const sourceWidth = bounds.width + EXPORT_PADDING * 2;
  const sourceHeight = bounds.height + EXPORT_PADDING * 2;
  const scale = variant === "print" ? 1 : exportScale(sourceWidth, sourceHeight);
  const width = Math.max(1, Math.ceil(sourceWidth * scale));
  const height = Math.max(1, Math.ceil(sourceHeight * scale));
  const offsetX = (EXPORT_PADDING - bounds.x) * scale;
  const offsetY = (EXPORT_PADDING - bounds.y) * scale;
  const style = {
    height: `${height}px`,
    overflow: "visible",
    transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`,
    transformOrigin: "top left",
    width: `${width}px`,
  };
  const flowElement = viewport.closest<HTMLElement>(".genealogy-flow");

  flowElement?.classList.add("is-exporting");
  flowElement?.classList.toggle("is-print-export", variant === "print");
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

  try {
    let blob: Blob | null;

    if (variant === "print") {
      const svgDataUrl = await toSvg(viewport, {
        backgroundColor: EXPORT_BACKGROUNDS.print,
        cacheBust: true,
        height,
        skipFonts: false,
        style,
        width,
        filter: exportFilter,
      });
      blob = svgDataUrlToBlob(svgDataUrl);
    } else {
      blob = await toBlob(viewport, {
        backgroundColor: EXPORT_BACKGROUNDS.screen,
        cacheBust: true,
        canvasHeight: height,
        canvasWidth: width,
        height,
        pixelRatio: 1,
        skipFonts: true,
        style,
        width,
        filter: exportFilter,
      });
    }

    if (!blob) throw new Error("Nie udało się utworzyć pliku drzewa.");
    triggerDownload(blob, variant === "print" ? "drzewo-rodzinne-do-druku.svg" : "drzewo-rodzinne.png");
  } finally {
    flowElement?.classList.remove("is-exporting");
    flowElement?.classList.remove("is-print-export");
  }
}
