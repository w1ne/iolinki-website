#!/usr/bin/env python3
"""Check the documentation publication boundary and imported source provenance."""
import hashlib
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTENT = ROOT / 'docsite/content'


class DocumentationContract(unittest.TestCase):
    def test_imported_documents_are_pinned_and_unchanged(self):
        manifest = json.loads((ROOT / 'docsite/sources.json').read_text())
        self.assertGreaterEqual(len(manifest['documents']), 15)
        for document in manifest['documents']:
            with self.subTest(path=document['output']):
                self.assertRegex(document['revision'], r'^[a-f0-9]{40}$')
                self.assertRegex(document['source_sha256'], r'^[a-f0-9]{64}$')
                self.assertIn('/blob/' + document['revision'] + '/', document['source_url'])
                self.assertFalse(any(part in document['source'].lower() for part in
                                     ['agent_report', 'superpowers', '.pdf', 'agent_task']))
                data = (CONTENT / document['output']).read_bytes()
                self.assertEqual(hashlib.sha256(data).hexdigest(), document['published_sha256'])
                self.assertIn(document['source_url'], data.decode())

    def test_release_paths_and_evidence_are_published(self):
        for version in ['device/v2.1.0', 'master/v1.0.0']:
            for name in ['index', 'getting-started', 'porting', 'api', 'testing']:
                self.assertTrue((CONTENT / version / (name + '.md')).is_file(), version + '/' + name)
        evidence = (CONTENT / 'device/v2.1.0/simulation.md').read_text()
        self.assertIn('4ff8cbaaa87418ace5e85be45c220b371f8c5b6f', evidence)
        self.assertIn('d528c78e660530e76164cd99003a1d03e3b861ac', evidence)
        self.assertIn('experimental', evidence)
        self.assertIn('No physical-master', evidence)

    def test_publication_does_not_include_private_or_specification_files(self):
        for path in CONTENT.rglob('*'):
            self.assertNotIn(path.suffix.lower(), ['.pdf', '.ewp', '.bin', '.zip'])
            self.assertFalse(any(part in str(path).lower() for part in ['agent_reports', 'superpowers']))

    def test_generated_pages_are_rendered_and_searchable(self):
        for version in ['device/v2.1.0', 'master/v1.0.0']:
            html = (ROOT / 'docs' / version / 'index.html').read_text()
            self.assertIn('data-md-component="search"', html)
            self.assertIn('<h1', html)
        search = json.loads((ROOT / 'docs/search/search_index.json').read_text())
        self.assertGreater(len(search['docs']), 30)


if __name__ == '__main__':
    unittest.main()
