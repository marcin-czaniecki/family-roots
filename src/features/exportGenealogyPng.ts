import type { Node } from "@xyflow/react";
import { toBlob } from "html-to-image";
import { PERSON_H, PERSON_W, RELATION_SIZE } from "./genealogyLayout";

const EXPORT_PADDING = 120;
const MAX_EXPORT_DIMENSION = 16_000;
const MAX_EXPORT_PIXELS = 48_000_000;
const EXPORT_BACKGROUND = "#f3efe8";

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

function triggerDownload(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = "drzewo-rodzinne.png";
  link.href = url;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function downloadGenealogyPng(viewport: HTMLElement, nodes: Node[]) {
  const bounds = getTreeBounds(nodes);
  if (!bounds) throw new Error("Drzewo nie zawiera elementów do zapisania.");

  const sourceWidth = bounds.width + EXPORT_PADDING * 2;
  const sourceHeight = bounds.height + EXPORT_PADDING * 2;
  const scale = exportScale(sourceWidth, sourceHeight);
  const width = Math.max(1, Math.ceil(sourceWidth * scale));
  const height = Math.max(1, Math.ceil(sourceHeight * scale));
  const offsetX = (EXPORT_PADDING - bounds.x) * scale;
  const offsetY = (EXPORT_PADDING - bounds.y) * scale;
  const flowElement = viewport.closest<HTMLElement>(".genealogy-flow");

  flowElement?.classList.add("is-exporting");
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

  try {
    const blob = await toBlob(viewport, {
      backgroundColor: EXPORT_BACKGROUND,
      cacheBust: true,
      canvasHeight: height,
      canvasWidth: width,
      height,
      pixelRatio: 1,
      skipFonts: true,
      style: {
        height: `${height}px`,
        overflow: "visible",
        transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`,
        transformOrigin: "top left",
        width: `${width}px`,
      },
      width,
      filter: (node) => !(node instanceof Element && (node.matches("button") || node.matches(".react-flow__handle"))),
    });
    if (!blob) throw new Error("Nie udało się utworzyć obrazu PNG.");
    triggerDownload(blob);
  } finally {
    flowElement?.classList.remove("is-exporting");
  }
}
