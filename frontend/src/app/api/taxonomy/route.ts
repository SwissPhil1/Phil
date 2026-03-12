import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Default seed data — used to populate the DB on first access
const DEFAULT_SYSTEMS: { key: string; label: string; sortOrder: number; organs: { key: string; label: string; sortOrder: number }[] }[] = [
  { key: "gi", label: "Gastro-intestinal", sortOrder: 0, organs: [
    { key: "esophagus", label: "Œsophage", sortOrder: 0 },
    { key: "stomach", label: "Estomac", sortOrder: 1 },
    { key: "small_bowel", label: "Grêle", sortOrder: 2 },
    { key: "colon", label: "Côlon & Rectum", sortOrder: 3 },
    { key: "liver", label: "Foie", sortOrder: 4 },
    { key: "biliary", label: "Voies biliaires", sortOrder: 5 },
    { key: "pancreas", label: "Pancréas", sortOrder: 6 },
    { key: "spleen", label: "Rate", sortOrder: 7 },
    { key: "peritoneum", label: "Péritoine & Mésentère", sortOrder: 8 },
  ] },
  { key: "genito_urinary", label: "Génito-urinaire", sortOrder: 1, organs: [
    { key: "kidney", label: "Reins", sortOrder: 0 },
    { key: "bladder", label: "Vessie & Prostate", sortOrder: 1 },
    { key: "uterus", label: "Utérus & Ovaires", sortOrder: 2 },
    { key: "retroperitoneum", label: "Rétropéritoine", sortOrder: 3 },
    { key: "adrenal", label: "Surrénales", sortOrder: 4 },
  ] },
  { key: "thorax", label: "Thorax", sortOrder: 2, organs: [
    { key: "chest", label: "Poumons", sortOrder: 0 },
    { key: "heart", label: "Cœur", sortOrder: 1 },
    { key: "mediastinum", label: "Médiastin", sortOrder: 2 },
  ] },
  { key: "vascular", label: "Vasculaire", sortOrder: 3, organs: [
    { key: "aorta", label: "Aorte", sortOrder: 0 },
    { key: "mesenteric_vessels", label: "Vaisseaux mésentériques", sortOrder: 1 },
    { key: "venous", label: "Système veineux", sortOrder: 2 },
    { key: "peripheral_vascular", label: "Vascularisation périphérique", sortOrder: 3 },
  ] },
  { key: "neuro", label: "Neuro", sortOrder: 4, organs: [
    { key: "brain", label: "Cerveau", sortOrder: 0 },
    { key: "spine", label: "Rachis", sortOrder: 1 },
  ] },
  { key: "msk", label: "Musculosquelettique", sortOrder: 5, organs: [
    { key: "msk", label: "MSK", sortOrder: 0 },
  ] },
  { key: "breast", label: "Sénologie", sortOrder: 6, organs: [
    { key: "breast", label: "Sein", sortOrder: 0 },
  ] },
  { key: "head_neck", label: "Tête & Cou", sortOrder: 7, organs: [
    { key: "head_neck", label: "Tête & Cou", sortOrder: 0 },
  ] },
  { key: "pediatric", label: "Pédiatrique", sortOrder: 8, organs: [
    { key: "pediatric", label: "Pédiatrique", sortOrder: 0 },
  ] },
  { key: "nuclear", label: "Médecine nucléaire", sortOrder: 9, organs: [
    { key: "nuclear", label: "Médecine nucléaire", sortOrder: 0 },
  ] },
  { key: "interventional", label: "Interventionnel", sortOrder: 10, organs: [
    { key: "interventional", label: "Interventionnel", sortOrder: 0 },
  ] },
];

async function ensureSeeded() {
  const count = await prisma.systemCategory.count();
  if (count > 0) return;

  for (const sys of DEFAULT_SYSTEMS) {
    const created = await prisma.systemCategory.create({
      data: {
        key: sys.key,
        label: sys.label,
        sortOrder: sys.sortOrder,
      },
    });
    for (const org of sys.organs) {
      await prisma.organCategory.create({
        data: {
          key: org.key,
          label: org.label,
          sortOrder: org.sortOrder,
          systemId: created.id,
        },
      });
    }
  }
}

/**
 * GET /api/taxonomy — returns all systems with their organs, ordered
 */
export async function GET() {
  try {
    await ensureSeeded();

    const systems = await prisma.systemCategory.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        organs: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    return NextResponse.json(systems);
  } catch (error: unknown) {
    console.error("Taxonomy GET error:", error);
    return NextResponse.json({ error: "Failed to load taxonomy" }, { status: 500 });
  }
}

/**
 * POST /api/taxonomy — create or update systems/organs
 * Body: { action: "add_system", key, label } | { action: "add_organ", systemId, key, label } | { action: "rename_system", id, label } | { action: "rename_organ", id, label }
 */
export async function POST(request: Request) {
  try {
    await ensureSeeded();

    const body = await request.json();
    const { action } = body;

    if (action === "add_system") {
      const { key, label } = body;
      if (!key || !label) return NextResponse.json({ error: "Missing key or label" }, { status: 400 });
      const maxOrder = await prisma.systemCategory.aggregate({ _max: { sortOrder: true } });
      const system = await prisma.systemCategory.create({
        data: { key, label, sortOrder: (maxOrder._max.sortOrder ?? 0) + 1 },
      });
      return NextResponse.json(system);
    }

    if (action === "add_organ") {
      const { systemId, key, label } = body;
      if (!systemId || !key || !label) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
      const maxOrder = await prisma.organCategory.aggregate({
        where: { systemId },
        _max: { sortOrder: true },
      });
      const organ = await prisma.organCategory.create({
        data: { key, label, sortOrder: (maxOrder._max.sortOrder ?? 0) + 1, systemId },
      });
      return NextResponse.json(organ);
    }

    if (action === "rename_system") {
      const { id, label } = body;
      const system = await prisma.systemCategory.update({ where: { id }, data: { label } });
      return NextResponse.json(system);
    }

    if (action === "rename_organ") {
      const { id, label } = body;
      const organ = await prisma.organCategory.update({ where: { id }, data: { label } });
      return NextResponse.json(organ);
    }

    if (action === "delete_system") {
      const { id } = body;
      await prisma.organCategory.deleteMany({ where: { systemId: id } });
      await prisma.systemCategory.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    }

    if (action === "delete_organ") {
      const { id } = body;
      await prisma.organCategory.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: unknown) {
    console.error("Taxonomy POST error:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
