import { PlopTypes } from '@turbo/gen'

export default function generator(plop: PlopTypes.NodePlopAPI): void {
  plop.setGenerator('app', {
    description: 'Creates a new app',
    prompts: [
      {
        type: 'input',
        name: 'name',
        message: 'What is the name of the new app?',
      },
    ],
    actions: [
      {
        type: 'add',
        path: '{{ turbo.paths.root }}/apps/{{ dashCase name }}/package.json',
        templateFile: 'templates/app/package.json.hbs',
      },
      {
        type: 'add',
        path: '{{ turbo.paths.root }}/apps/{{ dashCase name }}/tsconfig.json',
        templateFile: 'templates/app/tsconfig.json.hbs',
      },
      {
        type: 'add',
        path: '{{ turbo.paths.root }}/apps/{{ dashCase name }}/src/index.ts',
        templateFile: 'templates/app/src/index.ts.hbs',
      },
    ],
  })

  plop.setGenerator('device', {
    description: 'Creates a new device',
    prompts: [
      {
        type: 'input',
        name: 'name',
        message: 'What is the name of the new device?',
      },
    ],
    actions: [
      {
        type: 'add',
        path: '{{ turbo.paths.root }}/devices/{{ dashCase name }}/package.json',
        templateFile: 'templates/device/package.json.hbs',
      },
      {
        type: 'add',
        path: '{{ turbo.paths.root }}/devices/{{ dashCase name }}/src/index.ts',
        templateFile: 'templates/device/src/index.ts.hbs',
      },
      {
        type: 'add',
        path: '{{ turbo.paths.root }}/devices/{{ dashCase name }}/tsconfig.json',
        templateFile: 'templates/device/tsconfig.json.hbs',
      },
    ],
  })

  plop.setGenerator('module', {
    description: 'Creates a new module',
    prompts: [
      {
        type: 'input',
        name: 'name',
        message: 'What is the name of the new module?',
      }
    ],
    actions: [
      {
        type: 'add',
        path: '{{ turbo.paths.root }}/modules/{{ dashCase name }}/package.json',
        templateFile: 'templates/module/package.json.hbs',
      },
      {
        type: 'add',
        path: '{{ turbo.paths.root }}/modules/{{ dashCase name }}/assembly/index.ts',
        templateFile: 'templates/module/assembly/index.ts.hbs',
      },
      {
        type: 'add',
        path: '{{ turbo.paths.root }}/modules/{{ dashCase name }}/assembly/tsconfig.json',
        templateFile: 'templates/module/assembly/tsconfig.json',
      },
      {
        type: 'add',
        path: '{{ turbo.paths.root }}/modules/{{ dashCase name }}/tests/index.js',
        templateFile: 'templates/module/tests/index.js',
      },
      {
        type: 'add',
        path: '{{ turbo.paths.root }}/modules/{{ dashCase name }}/asconfig.json',
        templateFile: 'templates/module/asconfig.json',
      },
      {
        type: 'add',
        path: '{{ turbo.paths.root }}/modules/{{ dashCase name }}/index.html',
        templateFile: 'templates/module/index.html',
      },
    ],
  })
}
