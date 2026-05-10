# Package artifact smoke checks

The package artifact smoke checks create temporary projects instead of storing
sample projects in this directory. Run the checks from `klo/`:

```bash
source .venv/bin/activate
pnpm run artifacts:check
```

The npm smoke project installs the generated `@klo/context` and `@klo/cli`
tarballs, imports public package entry points, and runs installed `klo`
commands against a generated local project.

The Python smoke project installs `klo-daemon` through the local artifact
directory, imports `semantic_layer` and `klo_daemon`, and runs
`python -m klo_daemon semantic-validate`.
