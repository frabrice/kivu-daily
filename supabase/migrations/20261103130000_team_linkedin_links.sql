/*
# The team's LinkedIn links and two titles (MD, 3 Nov 2026)

Given by the MD for kivuride.com's team. Rodrigue has no link yet. Later
changes are made in MD Panel > Departments > "LinkedIn links".

Titles (shown on the website and when the Call Center assigns an issue):
- HABIMANA Jean Luc: Marketing Head
- NIYOKWIZERWA Fabrice: CTO
*/

UPDATE profiles SET linkedin_url = v.url, updated_at = now()
FROM (VALUES
  ('7641b7b3-4288-427a-b72b-f53c6f0a54c2'::uuid, 'https://www.linkedin.com/in/niyigena-frabrice-09a346181'),  -- NIYIGENA Frabrice
  ('24bc6cad-637e-495d-9898-4fa80c835436'::uuid, 'https://www.linkedin.com/in/jean-luc-habimana'),         -- HABIMANA Jean Luc
  ('97fb52ec-0a3a-4082-a857-ea29032ae486'::uuid, 'https://www.linkedin.com/in/imanariyobaptiste'),         -- Imanariyo Baptiste
  ('14ec9140-f096-4630-ac5e-c854a6b7be12'::uuid, 'https://www.linkedin.com/in/janviere-uwera'),            -- Uwera Janviere
  ('6c0a8725-f737-417f-8889-1b02d1bc98e2'::uuid, 'https://www.linkedin.com/in/fabrice-niyokwizerwa-a8402225a') -- NIYOKWIZERWA Fabrice
) AS v(id, url)
WHERE profiles.id = v.id;

UPDATE profiles SET responsibility_label = 'Marketing Head', updated_at = now() WHERE id = '24bc6cad-637e-495d-9898-4fa80c835436';
UPDATE profiles SET responsibility_label = 'CTO', updated_at = now() WHERE id = '6c0a8725-f737-417f-8889-1b02d1bc98e2';
