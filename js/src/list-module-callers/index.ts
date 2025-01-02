import * as core from "@actions/core";
import * as fs from "fs";
import * as path from "path";
import * as child_process from "child_process";
import { buildModuleToCallers, resolveRelativeCallTree } from "./lib";

export const main = async () => {
  const configFiles = fs
    .readFileSync(core.getInput("config_files"), "utf8")
    .split("\n");
  const moduleFiles = fs
    .readFileSync(core.getInput("module_files"), "utf8")
    .split("\n");
  const terraformCommand = core.getInput("terraform_command")

  // directory where uses modules => modules which are used
  const rawModuleCalls: Record<string, Array<string>> = {};

  const allTerraformFiles = Array.from([...configFiles, ...moduleFiles]);

  allTerraformFiles.forEach((tfFile) => {
    if (tfFile == "") {
      return;
    }

    const tfDir = path.dirname(tfFile);
    const inspection = JSON.parse(
      child_process
        .execSync(`terraform-config-inspect --json ${tfDir}`)
        .toString("utf-8"),
    );

    // List keys of Local Path modules (source starts with ./ or ../) in module_calls
    rawModuleCalls[tfDir] = Object.values(inspection["module_calls"]).flatMap(
      (module: any) => {
        const source = module.source;
        if (source.startsWith("./") || source.startsWith("../")) {
          return [source];
        } else {
          return [];
        }
      },
    );

    if (fs.existsSync(tfDir + "/terragrunt.hcl")) {
      const tgOutputFile = path.join(tfDir, "terragrunt_output.json");
      child_process.execSync(`terragrunt render-json --terragrunt-json-out ${tgOutputFile} --terragrunt-working-dir ${tfDir}`);
      const tgInspection = JSON.parse(fs.readFileSync(tgOutputFile, "utf8"));
      fs.unlinkSync(tgOutputFile);
      core.info(`tgInspection: ${JSON.stringify(tgInspection)}`);
      const source = tgInspection.terraform?.source;
      if (source.startsWith("./") || source.startsWith("../")) {
        rawModuleCalls[tfDir].push(source.replace("//", "/"))
      } else {
        return;
      }
      core.info(`rawModuleCalls: ${JSON.stringify(rawModuleCalls)}`);
    };
  });


  const moduleCallers = buildModuleToCallers(
    resolveRelativeCallTree(rawModuleCalls),
  );
  const json = JSON.stringify(moduleCallers);
  core.info(`file: ${json}`);
  core.setOutput("file", json);
};
