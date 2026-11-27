"""Source-level fail-closed boundary checks: never use the native shell for copy execution.

These are structural regression guards, not a broker acceptance test.
"""
import ast
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parent


def calls(path, name):
    tree=ast.parse((ROOT/path).read_text(encoding='utf-8'))
    return [node for node in ast.walk(tree)
            if isinstance(node,ast.Call) and
            (getattr(node.func,'attr',None)==name or getattr(node.func,'id',None)==name)]


def has_kw(call,name,kind,value=None):
    return any(k.arg==name and isinstance(k.value,kind)
               and (value is None or k.value.value==value) for k in call.keywords)


class CaptureOnlyBoundaryTests(unittest.TestCase):
    def test_signal_desk_call_never_enables_copy_cycle(self):
        entry_calls=calls(Path('desktop/bridge/desktop_bridge.py'),'main')
        self.assertTrue(any(has_kw(x,'copy_execution_enabled',ast.Constant,False)
                            for x in entry_calls),
                        'Signal Desk must explicitly disable order execution')

    def test_worker_and_supervisor_propagate_policy_without_reverting_default(self):
        main_calls=calls(Path('connect.py'),'run_supervisor')
        self.assertTrue(any(has_kw(x,'copy_execution_enabled',ast.Name)
                            for x in main_calls))
        scanner_calls=calls(Path('concurrent_capture.py'),'scan')
        self.assertTrue(any(has_kw(x,'copy_execution_enabled',ast.Name)
                            for x in scanner_calls))
        source=(ROOT/'concurrent_capture.py').read_text(encoding='utf-8')
        tree=ast.parse(source)
        worker_spawns=[x for x in ast.walk(tree)
                       if isinstance(x,ast.Call) and
                       getattr(x.func,'attr',None)=='Process']
        self.assertTrue(any(
            any(k.arg=='args' and isinstance(k.value,ast.Tuple) and
                any(isinstance(a,ast.Name) and a.id=='copy_execution_enabled'
                    for a in k.value.elts) for k in spawn.keywords)
            for spawn in worker_spawns),
            'Supervisor must pass the read-only flag into each spawned account worker')

    def test_scan_copy_cycle_is_guarded_by_permission(self):
        tree=ast.parse((ROOT/'connect.py').read_text(encoding='utf-8'))
        scan=next(node for node in tree.body if isinstance(node,ast.FunctionDef)
                  and node.name=='scan')
        conditional=any(isinstance(node,ast.If) and
                         isinstance(node.test,ast.Name) and
                         node.test.id=='copy_execution_enabled' and
                         any(isinstance(child,ast.ImportFrom) and
                             child.module=='copy_bridge' for child in ast.walk(node))
                        for node in ast.walk(scan))
        self.assertTrue(conditional,
            'The copier must never be loaded when a Signal Desk scan is read-only')


if __name__=='__main__':
    unittest.main()
