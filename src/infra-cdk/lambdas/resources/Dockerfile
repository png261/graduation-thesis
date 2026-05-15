FROM public.ecr.aws/lambda/python:3.12

RUN pip install --no-cache-dir boto3 "PyJWT[crypto]" terraformgraph==1.0.4 "python-hcl2<8"
RUN python -c "from functools import reduce; from pathlib import Path; import terraformgraph.icons as icons; path=Path(icons.__file__); replacements=(('Arch_Database','Arch_Databases'),('Arch_App-Integration','Arch_Application-Integration'),('Arch_Security-Identity-Compliance','Arch_Security-Identity'),('Arch_Management-Governance','Arch_Management-Tools')); path.write_text(reduce(lambda text, pair: text.replace(pair[0], pair[1]), replacements, path.read_text()))"
RUN python -c "import shutil, urllib.request, zipfile; from pathlib import Path; url='https://d1.awsstatic.com/onedam/marketing-channels/website/aws/en_US/architecture/approved/architecture-icons/Icon-package_01302026.31b40d126ed27079b708594940ad577a86150582.zip'; archive=Path('/tmp/aws-icons.zip'); dest=Path('/opt/aws-official-icons'); urllib.request.urlretrieve(url, archive); shutil.rmtree(dest, ignore_errors=True); dest.mkdir(parents=True, exist_ok=True); zipfile.ZipFile(archive).extractall(dest); shutil.rmtree(dest / '__MACOSX', ignore_errors=True); archive.unlink()"

COPY index.py ${LAMBDA_TASK_ROOT}/index.py

CMD ["index.handler"]
