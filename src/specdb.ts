import * as fs from 'fs';
import * as path from 'path';
import { Project } from './project';

export interface Location {
  file: string; // absolute
  line: number; // 1-based
}

export interface ObjectInfo extends Location {
  pid: string | null;
  label: string | null;
  type: string;
  title: string;
  spec: string;
}

export interface FloatInfo extends Location {
  label: string;
  type: string;
  caption: string | null;
  spec: string;
}

import type { Database, SqlJsStatic } from 'sql.js';

let sqlPromise: Promise<SqlJsStatic> | undefined;

/** sql.js is loaded from media/ at runtime so the wasm sits next to it. */
function initSql(extensionPath: string): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const init = require(path.join(extensionPath, 'media', 'sql-wasm.js'));
    sqlPromise = init({ locateFile: (f: string) => path.join(extensionPath, 'media', f) });
  }
  return sqlPromise!;
}

interface Cached {
  mtimeMs: number;
  size: number;
  db: Database;
}

/**
 * Read-only access to <output_dir>/specir.db, reloaded whenever the file on
 * disk changes (every save triggers a build, which rewrites it).
 */
export class SpecDb {
  private cache = new Map<string, Cached>();

  constructor(private readonly extensionPath: string) {}

  dbPath(project: Project): string {
    return path.join(project.outputDir, 'specir.db');
  }

  private async open(project: Project): Promise<Database | undefined> {
    const file = this.dbPath(project);
    let st: fs.Stats;
    try {
      st = fs.statSync(file);
    } catch {
      return undefined;
    }
    const hit = this.cache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.db;
    const SQL = await initSql(this.extensionPath);
    const db = new SQL.Database(fs.readFileSync(file));
    hit?.db.close();
    this.cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, db });
    return db;
  }

  private abs(project: Project, rel: string): string {
    return path.resolve(project.rootDir, rel);
  }

  private async rows<T>(project: Project, sql: string, params: unknown[]): Promise<T[]> {
    const db = await this.open(project);
    if (!db) return [];
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params as any);
      const out: T[] = [];
      while (stmt.step()) out.push(stmt.getAsObject() as T);
      return out;
    } finally {
      stmt.free();
    }
  }

  private toObject(project: Project, r: any): ObjectInfo {
    return {
      pid: r.pid, label: r.label, type: r.type_ref, title: r.title_text, spec: r.specification_ref,
      file: this.abs(project, r.from_file), line: r.start_line ?? 1,
    };
  }

  /** `[PID](@)` */
  async objectByPid(project: Project, pid: string): Promise<ObjectInfo[]> {
    const rows = await this.rows<any>(project,
      'SELECT pid,label,type_ref,title_text,specification_ref,from_file,start_line FROM spec_objects WHERE pid = ?', [pid]);
    return rows.map((r) => this.toObject(project, r));
  }

  /** `[type:label](#)` or `[scope:type:label](#)`: objects first, then floats. */
  async byLabel(project: Project, selector: string): Promise<Array<ObjectInfo | FloatInfo>> {
    const parts = selector.split(':');
    let scope: string | undefined;
    let label = selector;
    if (parts.length >= 3) { scope = parts[0]; label = parts.slice(1).join(':'); }
    const scopeSql = scope ? ' AND (specification_ref = ? OR specification_ref IN (SELECT identifier FROM specifications WHERE pid = ?))' : '';
    const scopeParams = scope ? [scope, scope] : [];
    const objs = await this.rows<any>(project,
      `SELECT pid,label,type_ref,title_text,specification_ref,from_file,start_line FROM spec_objects WHERE label = ?${scopeSql}`,
      [label, ...scopeParams]);
    const floats = await this.rows<any>(project,
      `SELECT label,type_ref,caption,specification_ref,from_file,start_line FROM spec_floats WHERE label = ?${scopeSql}`,
      [label, ...scopeParams]);
    return [
      ...objs.map((r) => this.toObject(project, r)),
      ...floats.map((r): FloatInfo => ({
        label: r.label, type: r.type_ref, caption: r.caption, spec: r.specification_ref,
        file: this.abs(project, r.from_file), line: r.start_line ?? 1,
      })),
    ];
  }

  dispose(): void {
    for (const c of this.cache.values()) c.db.close();
    this.cache.clear();
  }
}
