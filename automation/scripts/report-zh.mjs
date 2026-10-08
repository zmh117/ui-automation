import { writeChineseReports } from "../reporting/chinese-report.mjs";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--run" || !args[1] || args[1].startsWith("--")) {
  console.error('用法：npm run ui:report:zh -- --run "automation/output/<运行目录>"（在项目根目录执行）');
  process.exitCode = 1;
} else {
  try {
    for (const file of writeChineseReports(args[1])) console.log(`已生成：${file}`);
  } catch (error) {
    console.error(`生成中文报告失败：${error.message}`);
    process.exitCode = 1;
  }
}
