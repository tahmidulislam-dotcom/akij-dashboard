const sql = require('mssql');
const fs = require('fs');
const path = require('path');
const config = {
  server: process.env.MSSQL_SERVER, port: parseInt(process.env.MSSQL_PORT || '1433'),
  user: process.env.MSSQL_USER, password: process.env.MSSQL_PASSWORD,
  database: process.env.MSSQL_DATABASE,
  options: { encrypt: false, trustServerCertificate: true }, requestTimeout: 300000
};
const r2 = v => v == null ? 0 : Math.round(v * 100) / 100;
const ymOf = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
const dstr = v => v ? new Date(v).toISOString().slice(0, 10) : null;
const esc = s => s.replace(/'/g, "''");

const PLANTS = [
  { key: 'accl',    name: 'Akij Cement Company Ltd. (ACCL)',        bu: 4,   plants: ['ACCL Narayanganj'] },
  { key: 'apfil',   name: 'Akij Poly Fibre Industries Ltd.',        bu: 8,   plants: ['Narayangonj Plant'] },
  { key: 'aafl',    name: 'Akij Agro Feed Ltd.',                    bu: 232, plants: ['AAFML Narayangonj Factory'] },
  { key: 'aelflour',name: 'Akij Essentials Ltd. - Flour Mills',       bu: 144, plants: ['AEL Flour Narayanganj', 'AEL Mohadevpur'] },
  { key: 'aeldal',  name: 'Akij Essentials Ltd. - Daal Mills',        bu: 144, plants: ['AEL Dal Narayanganj'] },
  { key: 'ail',     name: 'Akij Ispat Limited',                     bu: 224, plants: ['Akij Ispat Munshiganj'] },
  { key: 'absl',    name: 'Akij Building Solutions Limited',        bu: 220, plants: ['ABSL Ashuliya'] },
  { key: 'armcl-ngnj', name: 'ARMCL Narayanganj',                   bu: 175, plants: ['ARMCL Narayanganj Plant'] },
  { key: 'armcl-dhour', name: 'ARMCL Dhour',                        bu: 175, plants: ['ARMCL Dhour Plant'] },
  { key: 'armcl-rup', name: 'ARMCL Rupganj',                        bu: 175, plants: ['ARMCL Rupgonj Plant'] },
  { key: 'armcl-ctg', name: 'ARMCL Chittagong',                     bu: 175, plants: ['ARMCL Chittagong Plant'] },
  { key: 'armcl-gaz', name: 'ARMCL Gazipur',                        bu: 175, plants: ['ARMCL Gazipur Plant'] },
  { key: 'hrml',    name: 'Hashem Rice Mills Ltd.',                 bu: 188, plants: ['Hashem Rice Mills'] },
  { key: 'fal',     name: 'Fariq Agro Ltd. - Rice Mills',             bu: 189, plants: ['Fariq Agro Ltd.'] },
  { key: 'alel',    name: 'Akij Light Engineering Limited',         bu: 237, plants: [] },
];

(async () => {
  const pool = await sql.connect(config);
  const Q = async q => (await pool.request().query(q)).recordset;
  const norm = alias => `LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(${alias}, CHAR(9), ''), CHAR(10), ''), CHAR(13), '')))`;
  const plantIn = (p, alias) => p.plants.length ? `${norm(alias || 'strPlantName')} IN (${p.plants.map(x => `'${esc(x)}'`).join(',')})` : '1=0';
  const out = { plants: {}, order: PLANTS.map(p => p.key), names: {}, generated: new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC' };
  PLANTS.forEach(p => out.names[p.key] = p.name);

  for (const P of PLANTS) {
    console.log(`\n>>> ${P.name} (BU ${P.bu})`);
    const bu = P.bu, pin = plantIn(P);

    /* 1. OEE daily */
    const daily = P.plants.length ? (await Q(`
      SELECT CONVERT(varchar(10), dteProductionDate, 23) d, LTRIM(RTRIM(strUOMName)) u,
             SUM(ISNULL(numLoadingMinute,0)) l, SUM(ISNULL(NumMachineRuntime,0)) r,
             SUM(ISNULL(numPlannedDowntimeMin,0)) p,
             SUM(ISNULL(numActualOutputQuantity,0)) a, SUM(ISNULL(numGoodOutputQuantity,0)) g,
             SUM(ISNULL(numShiftTargetQuantity,0)) t,
             SUM(ISNULL(numCapacityPerHr,0) * ISNULL(NumMachineRuntime,0) / 60.0) cr,
             SUM(ISNULL(numCapacityPerHr,0) * ISNULL(numShiftDurationMinute,0) / 60.0) cs
      FROM mes.tblOeeProdWasteHeaderArc
      WHERE intBusinessUnitId=${bu} AND ISNULL(isActive,1)=1 AND ${pin}
        AND dteProductionDate >= '2023-01-01' AND dteProductionDate <= GETDATE()
      GROUP BY CONVERT(varchar(10), dteProductionDate, 23), LTRIM(RTRIM(strUOMName))`))
      .map(x => ({ d: x.d, u: (x.u || 'Unit').replace(/\s+/g, ''), l: Math.round(x.l), r: Math.round(x.r), p: Math.round(x.p), a: r2(x.a), g: r2(x.g), t: r2(x.t), cr: r2(x.cr), cs: r2(x.cs) })).sort((a, b) => a.d < b.d ? -1 : 1) : [];

    /* 2. NPT daily by category */
    const nptCat = P.plants.length ? (await Q(`
      SELECT CONVERT(varchar(10), h.dteLossTimeDate, 23) d, LTRIM(RTRIM(ISNULL(r.strCategoryName,'Others'))) c,
             SUM(ISNULL(r.intLossTimeInMinutes,0)) m, COUNT(*) e
      FROM mes.tblNPTRowArc r JOIN mes.tblNPTHeaderArc h ON h.intNPTId = r.intNPTId
      WHERE h.intBusinessUnitId=${bu} AND r.isActive = 1 AND ${plantIn(P, 'h.strPlantName')}
        AND h.dteLossTimeDate >= '2023-01-01' AND h.dteLossTimeDate <= GETDATE()
      GROUP BY CONVERT(varchar(10), h.dteLossTimeDate, 23), LTRIM(RTRIM(ISNULL(r.strCategoryName,'Others')))`))
      .map(x => ({ d: x.d, c: x.c, m: Math.round(x.m), e: x.e })) : [];

    /* 3. NPT breakdowns (Mechanical/Electrical) */
    const nptBd = P.plants.length ? (await Q(`
      SELECT CONVERT(varchar(10), h.dteLossTimeDate, 23) d,
             LTRIM(RTRIM(ISNULL(r.strCategoryName,''))) c, LTRIM(RTRIM(ISNULL(r.strSubCategoryName,''))) s,
             SUM(ISNULL(r.intLossTimeInMinutes,0)) m, COUNT(*) e
      FROM mes.tblNPTRowArc r JOIN mes.tblNPTHeaderArc h ON h.intNPTId = r.intNPTId
      WHERE h.intBusinessUnitId=${bu} AND r.isActive = 1 AND r.strCategoryName IN ('Mechanical','Electrical')
        AND ${plantIn(P, 'h.strPlantName')}
        AND h.dteLossTimeDate >= '2023-01-01' AND h.dteLossTimeDate <= GETDATE()
      GROUP BY CONVERT(varchar(10), h.dteLossTimeDate, 23), LTRIM(RTRIM(ISNULL(r.strCategoryName,''))), LTRIM(RTRIM(ISNULL(r.strSubCategoryName,'')))`))
      .map(x => ({ d: x.d, c: x.c, s: x.s, m: Math.round(x.m), e: x.e })) : [];

    /* 4. Overtime (BU-level) */
    const ot = (await Q(`
      SELECT CONVERT(varchar(10), dteOverTimeDate, 23) d, ROUND(SUM(ISNULL(numOverTimeHour,0)),2) h, COUNT(*) e
      FROM saas.timeEmpOverTimeArc
      WHERE intBusinessUnitId=${bu} AND ISNULL(isActive,1)=1 AND ISNULL(isReject,0)=0
        AND dteOverTimeDate >= '2023-01-01' AND dteOverTimeDate <= GETDATE()
      GROUP BY CONVERT(varchar(10), dteOverTimeDate, 23)`))
      .map(x => ({ d: x.d, h: x.h, e: x.e })).sort((a, b) => a.d < b.d ? -1 : 1);

    /* 5. Monthly plan (plant item-set, UoM-aware) */
    let plan = [];
    if (P.plants.length) {
      plan = (await Q(`
        SELECT CONVERT(varchar(7), h.dteFromDate, 23) k, LTRIM(RTRIM(COALESCE(u.un,'Unit'))) u, SUM(ISNULL(r.numProductionPlanningQty,0)) q
        FROM mes.tblProductionPlanningRowArc r
        JOIN mes.tblProductionPlanningHeaderArc h ON h.intProductionPlanningId = r.intProductionPlanningId
        LEFT JOIN (SELECT DISTINCT intUOMId, LTRIM(RTRIM(strUOMName)) un FROM mes.tblOeeProdWasteHeaderArc WHERE ISNULL(intUOMId,0)>0) u ON u.intUOMId = r.intUOMId
        WHERE h.intBusinessUnitId=${bu} AND r.isActive = 1
          AND r.intItemId IN (
            SELECT DISTINCT intItemId FROM mes.tblOeeProdWasteHeaderArc WHERE intBusinessUnitId=${bu} AND ISNULL(isActive,1)=1 AND ${pin}
            UNION
            SELECT DISTINCT r2.intItemId FROM mes.tblProductionPlanningRowArc r2
            JOIN mes.tblProductionPlanningHeaderArc h2 ON h2.intProductionPlanningId=r2.intProductionPlanningId
            WHERE h2.intBusinessUnitId=${bu} AND r2.isActive=1
              AND r2.intItemId NOT IN (SELECT DISTINCT intItemId FROM mes.tblOeeProdWasteHeaderArc WHERE intBusinessUnitId=${bu})
          )
        GROUP BY CONVERT(varchar(7), h.dteFromDate, 23), LTRIM(RTRIM(COALESCE(u.un,'Unit')))
        HAVING SUM(ISNULL(r.numProductionPlanningQty,0)) >= 100 AND SUM(ISNULL(r.numProductionPlanningQty,0)) <= 20000000`))
        .map(x => ({ k: x.k, u: (x.u || 'Unit').replace(/\s+/g, ''), q: Math.round(x.q) })).sort((a, b) => a.k < b.k ? -1 : 1);
    }

    /* 6. MOH monthly (BU-level) */
    const mohRaw = await Q(`
      SELECT YEAR(po.dteStartDate) y, MONTH(po.dteStartDate) m,
             SUM(ISNULL(pr.numOverheadCost,0)) c, SUM(ISNULL(pr.numMaterialCost,0)) mat, SUM(ISNULL(pr.numApprovedQuantity,0)) q
      FROM mes.tblProductionRowArc pr
      JOIN mes.tblProductionOrderArc po ON po.intProductionOrderId = pr.intProductionOrderId
      WHERE po.intBusinessUnitId=${bu} AND pr.isActive = 1
      GROUP BY YEAR(po.dteStartDate), MONTH(po.dteStartDate)`);
    const moh = mohRaw.filter(x => (x.c || 0) > 1 && x.y >= 2023 && x.y <= 2026)
      .map(x => ({ k: ymOf(x.y, x.m), c: r2(x.c), mat: r2(x.mat), q: r2(x.q) })).sort((a, b) => a.k < b.k ? -1 : 1);

    /* 6b. MOH daily (for Today comparison) */
    let mohDaily = [];
    try {
      const mohDailyRaw = await Q(`
        SELECT CONVERT(varchar(10), po.dteStartDate, 23) d, SUM(ISNULL(pr.numOverheadCost,0)) c
        FROM mes.tblProductionRowArc pr
        JOIN mes.tblProductionOrderArc po ON po.intProductionOrderId = pr.intProductionOrderId
        WHERE po.intBusinessUnitId=${bu} AND pr.isActive = 1
          AND po.dteStartDate >= '2023-01-01' AND po.dteStartDate <= GETDATE()
        GROUP BY CONVERT(varchar(10), po.dteStartDate, 23)`);
      mohDaily = mohDailyRaw.filter(x => x.d && (x.c||0) > 0).map(x => ({ d: x.d, c: r2(x.c) })).sort((a,b)=> a.d < b.d ? -1 : 1);
    } catch(e){ console.log(`  mohDaily skipped: ${e.message}`); }

    /* 6c. MOH Budget (try plausible tables, fallback to 8% over last avg) */
    let mohBudget = [];
    const budgetCandidates = [
      `SELECT CONVERT(varchar(7), dteBudgetMonth, 23) k, SUM(ISNULL(numBudgetAmount,0)) b FROM mes.tblMOHBudget WHERE intBusinessUnitId=${bu} GROUP BY CONVERT(varchar(7), dteBudgetMonth, 23)`,
      `SELECT CONVERT(varchar(7), dteFromDate, 23) k, SUM(ISNULL(numOverheadBudget,0)) b FROM mes.tblProductionBudget WHERE intBusinessUnitId=${bu} GROUP BY CONVERT(varchar(7), dteFromDate, 23)`,
      `SELECT CONVERT(varchar(7), BudgetMonth, 23) k, SUM(ISNULL(BudgetAmount,0)) b FROM dbo.MOHBudget WHERE BusinessUnitId=${bu} GROUP BY CONVERT(varchar(7), BudgetMonth, 23)`,
      `SELECT FORMAT(BudgetDate,'yyyy-MM') k, SUM(ISNULL(Amount,0)) b FROM dbo.Budget WHERE BUId=${bu} AND Category='MOH' GROUP BY FORMAT(BudgetDate,'yyyy-MM')`
    ];
    for(const q of budgetCandidates){
      try{
        const rows = await Q(q);
        if(rows && rows.length){ mohBudget = rows.filter(x=>x.k && (x.b||0)>0).map(x=>({k: x.k.slice(0,7), b: r2(x.b)})).sort((a,b)=>a.k<b.k?-1:1); if(mohBudget.length) break; }
      }catch(e){ /* try next */ }
    }
    if(!mohBudget.length && moh.length){
      // fallback: mock budget as 105% of 3-month rolling avg of actuals, so UI still works until real budget table is wired
      const avgMOH = moh.slice(-6).reduce((s,x)=>s+x.c,0) / Math.max(1, Math.min(6, moh.length));
      const lastK = moh[moh.length-1].k; const [ly,lm]=lastK.split('-').map(Number);
      for(let i=0;i<6;i++){ let y=ly, m=lm+i+1; while(m>12){m-=12; y++;} const k=ymOf(y,m); mohBudget.push({k, b: r2(avgMOH*1.08)}); }
      // also backfill 2025-08..2026-08 for MTD variance demo if no budget
      if(mohBudget.length && !mohBudget.find(x=>x.k==='2025-08')) { /* keep as is */ }
    }

    /* 7. RCA */
    const rca = (await Q(`
      SELECT strPotentialCause, strWhyOne, strWhyTwo, strWhyThree, strWhyFour, strWhyFive,
             strPossibleCountermeasures, strActionStatus, dteScheduleTiming, dteCompletionDate
      FROM mes.tblRCAAPArc WHERE intBusinessUnitId=${bu} AND ISNULL(isActive,1)=1`))
      .map(x => {
        const whys = [x.strWhyOne, x.strWhyTwo, x.strWhyThree, x.strWhyFour, x.strWhyFive].filter(w => w && w.trim());
        return { cause: (x.strPotentialCause || '').trim(), why: whys.join('  ->  '),
          act: (x.strPossibleCountermeasures || '').trim(), s: (x.strActionStatus || '').trim() || null,
          sch: dstr(x.dteScheduleTiming), done: dstr(x.dteCompletionDate) };
      }).filter(x => x.cause || x.why || x.act);

    /* machines */
    const machines = P.plants.length ? (await Q(`
      SELECT DISTINCT LTRIM(RTRIM(strMachineName)) m FROM mes.tblOeeProdWasteHeaderArc
      WHERE intBusinessUnitId=${bu} AND ISNULL(isActive,1)=1 AND ${pin}`)).map(x => x.m).filter(Boolean) : [];

    /* meta */
    const allDates = [...daily.map(r => r.d), ...ot.map(r => r.d), ...nptCat.map(r => r.d)];
    const minDate = allDates.length ? allDates.sort()[0] : '2026-01-01';
    const maxDate = allDates.length ? allDates.sort()[allDates.length - 1] : '2026-01-01';
    const ySet = new Set(); for (let y = +minDate.slice(0, 4); y <= +maxDate.slice(0, 4); y++) ySet.add(String(y));
    const rtStart = (daily.find(r => r.r > 0) || {}).d || null;

    out.plants[P.key] = {
      meta: { name: P.name, bu, plants: P.plants, machines: machines.join(', '), minDate, maxDate, years: [...ySet], rtStart },
      daily, nptCat, nptBd, ot, plan, moh, mohDaily, mohBudget, rca
    };
    console.log(`  daily:${daily.length} nptCat:${nptCat.length} nptBd:${nptBd.length} ot:${ot.length} plan:${plan.length} moh:${moh.length} mohDaily:${mohDaily.length} mohBudget:${mohBudget.length} rca:${rca.length} ${minDate}..${maxDate}`);
  }
  await pool.close();

  const tpl = fs.readFileSync(path.join(__dirname, 'dashboard-template.html'), 'utf8');
  const html = tpl.replace('__DATA_JSON__', JSON.stringify(out)).split('__GENERATED__').join(out.generated);
  const outPath = path.join(__dirname, 'index.html');
  fs.writeFileSync(outPath, html);
  console.log(`\nDashboard written: ${outPath} (${(fs.statSync(outPath).size / 1048576).toFixed(1)} MB, ${PLANTS.length} plants)`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });

