import { spawn } from "child_process";
import path from "path";
import { NextResponse } from "next/server";

function run(
  cmd: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {}
) {
  console.log('running', cmd, args);

  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      !key.startsWith('__NEXT_') &&
      !key.startsWith('NEXT_') &&
      !key.startsWith('TURBOPACK') &&
      key !== 'NODE_APP_INSTANCE'
    )
  );

  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: "inherit",
      shell: true,
      env: {
        ...cleanEnv,
        NODE_ENV: "production",
        PATH: process.env.PATH,
        ...env,
      } as unknown as NodeJS.ProcessEnv,
    });
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`"${cmd}" exited with code ${code}`))
    );
  });
}

export async function POST(request: Request) {
  const { repo, app_name } = await request.json();
  const target = path.join(process.cwd(), "../deployments", app_name);

  try {
    await run("git", ["clone", repo, target], process.cwd());
  } catch {}

  try {
    await run("npm", ["install"], target);
    await run("npm", ["run", "build"], target);
    await run(
      "pm2",
      ["start", "npm", "--name", `${app_name}`, "--", "--", "run", "start"],
      target,
      { PORT: "3001" },
    );
    return NextResponse.json({ message: "Repository created successfully!" });
  } catch (err: unknown) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Unknown error occurred" },
      { status: 500 }
    );
  }
}