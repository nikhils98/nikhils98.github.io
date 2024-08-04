---
id: 2
layout: ../../layouts/PostLayout.astro
title: Self Host Prefect Server With ECS Work Pool Using Pulumi
date: 2024-06-08 00:00
tags: ["prefect", "automation", "pulumi", "aws"]
---

Recently I was tasked with automating a python workflow to run on a weekly basis on AWS. The workflow consisted of some tasks that were very resource intensive and consumed a lot of memory but running a large server 24/7 for a workflow that executes only once a week would've been very wasteful and costly. The team was already using Prefect on their local machines and luckily it offers integration with Fargate which allows us to provision the infrastructure for running the tasks on demand.

This was a rather new experience for me and while I was able to find most of the information in the docs, I felt a detailed guide covering some of the little nuances would be useful for someone just getting started.

We will be using [Pulumi](https://www.pulumi.com/), an IaC framework, to manage the infrastructure on AWS. But if you're more familiar with Terraform or CDK, that'll do too of course. Familiarity with one of these frameworks and AWS would be helpful in following along this guide.

I'm using a Windows machine for development so a few terminal commands may vary in Mac/Linux. All our cloud instances will be Linux based however.

![Prefect self host aws architecture](/images/self-host-prefect-server/architecture-dark.png)

## Write a flow

The most fundamental object of Prefect is [flow](https://docs.prefect.io/latest/tutorial/flows/) which is essentially just a decorator over a python function that helps Prefect manage its lifecycle. A flow may contain invocations to other flows (referred to as **subflows**) or [tasks](https://docs.prefect.io/latest/tutorial/tasks/).

For this guide we'll write a simple flow that calculates mean and median of an integer array and prints the outputs.

First we'll create a new directory and in it a [virtual env](https://docs.python.org/3/library/venv.html)

```
python -m venv venv
venv/Scripts/activate
```

Then we create a `requirements.txt` with the content

```
prefect==2.20.0
```

And run pip install

```
pip install -r requirements.txt
```

And finally we write the flow in `main.py`

```
import statistics
from typing import List
from prefect import flow, task


@task
def calculate_mean(nums: List[int]):
    return statistics.mean(nums)


@task
def calculate_median(nums: List[int]):
    return statistics.median(nums)


@flow(log_prints=True)
def mean_and_median():
    nums = [5, 2, 2, 3, 5, 4]

    mean = calculate_mean(nums=nums)
    median = calculate_median(nums=nums)

    print(mean, median)


if __name__ == "__main__":
    mean_and_median()
```

Notice the `@flow` decorator on the entrypoint function and `@task` on the functions called inside it.

Before we can run this though we need to start the **server** on our machine. The Prefect package that we installed includes the server that comes with a pretty useful UI allowing us to configure and view the flows and a whole bunch of other things which we'll touch upon later in the guide. Most, if not all, of the configuration can be done programmatically as well but I find the UI very useful especially for viewing the flow runs and its logs.

Start the server with the following command which will launch it at http://127.0.0.1:4200
```
prefect server start
```

And finally we can run the flow now!
```
python main.py
```

**NOTE**: Although it shouldn't happen for first timers but if you get an error related to server address make sure you've set the config to point to the local server.
```
prefect config set PREFECT_API_URL="http://127.0.0.1:4200/api"
```


If the run is successful, you'll see similar logs in the terminal. You can also view it in the UI by navigating to the Flow Runs tabs.

```
19:08:24.767 | INFO    | prefect.engine - Created flow run 'khaki-bittern' for flow 'mean-and-median'
19:08:24.769 | INFO    | Flow run 'khaki-bittern' - View at http://127.0.0.1:4200/flow-runs/flow-run/145e0101-ea87-4c38-81f5-26fb9d41db45
19:08:24.818 | INFO    | Flow run 'khaki-bittern' - Created task run 'calculate_mean-0' for task 'calculate_mean'
19:08:24.819 | INFO    | Flow run 'khaki-bittern' - Executing 'calculate_mean-0' immediately...
19:08:25.026 | INFO    | Task run 'calculate_mean-0' - Finished in state Completed()
19:08:25.044 | INFO    | Flow run 'khaki-bittern' - Created task run 'calculate_median-0' for task 'calculate_median'
19:08:25.045 | INFO    | Flow run 'khaki-bittern' - Executing 'calculate_median-0' immediately...
19:08:25.093 | INFO    | Task run 'calculate_median-0' - Finished in state Completed()
19:08:25.094 | INFO    | Flow run 'khaki-bittern' - 3.5 3.5
19:08:25.117 | INFO    | Flow run 'khaki-bittern' - Finished in state Completed('All states completed.')
```

## Deploy

We manually trigerred the flow from command line which is not very different from running a regular python script apart from the fact that we can observe logs and set up [notifications](https://docs.prefect.io/latest/guides/host/#notifications) in the UI. We'd also like to delegate the invocation part to Prefect and schedule the runs and we can do that by creating a [deployment](https://docs.prefect.io/latest/tutorial/deployments/).

It's very simple to do so. We just have to update our main block to the following and it'll create a deployment in our local server running the flow every minute.

```
if __name__ == "__main__":
    mean_and_median.serve(name="deployment", cron="* * * * *")
```

While the server is up, simply run in the terminal
```
python main.py
```

This'll create an active session in your terminal listening for scheduled runs. Check the Deployment tab in the UI to see if an entry was made. Observe the logs in your terminal or the UI after a minute passes. The terminal session must remain active for the flow to run.

## Dynamically provision infrastructure

If we had a very simple flow similar to the one we've written then perhaps the above way of deploying would be sufficient and could be set up in a small EC2 instance. The scenario we're assuming, however, is that of a flow that's very resource intensive but runs infrequently. So we want to dynamically provision the infrastructre in order to save costs.

This is achieved by [work pools](https://docs.prefect.io/latest/tutorial/work-pools/) and [workers](https://docs.prefect.io/latest/tutorial/workers/). In this design, a worker process polls the server for scheduled runs of a deployment and starts a Fargate container for executing the flow accordingly. The container is automatically deprovisioned on completion of the execution.

If we were using Prefect cloud, we could've just defined a work pool and let them manage the workers. But in cases where data privacy and security is of utmost importance, it may be useful to manage the workers ourselves. Note even in that case we can continue to use Prefect cloud which will  essentially behave as the server only and comes with the benefit of built-in authentication which unfortunately is not available in the community version of the server. Since we're self hosting the server too and there's no authentication module, we'll block all public access - allowing incoming SSH/RDP to select IPs whenever it's required to connect to the server.

Going back to the architecture diagram, note that we'll be hosting the server and worker processes as ECS services deployed as containers in a small EC2 instance. This makes it easier to manage the environment variables and run version updates without connecting to the EC2 instance. Another interesting thing to note is the that flow's image is retrieved from ECR. We will be updating the deploy function in our flow script so that it creates a docker image and uploads to ECR. 

This design allows us to run our workflows on the cloud fully automated. *Prefect*!

![Prefect self host aws architecture](/images/self-host-prefect-server/architecture-dark.png)

### Pulumi: set up

To set it all up in AWS, let's create a new Pulumi project in python. If you're new to Pulumi, check out the official guide to [get started](https://www.pulumi.com/docs/clouds/aws/get-started/). Once you have the basics down, create a new subdirectory named `infrastructure` in the flow app directory and run the following to bootstrap a pulumi project within it.

```
cd infrastructure
pulumi new aws-python
```

Follow the steps in the cli and once you're done you'll have a similar structure of files (I removed .gitignore created with the Pulumi project by default)

```
infrastructure
    __main__.py
    Pulumi.dev.yaml
    Pulumi.yaml
    requirements.txt
.gitignore
main.py
requirements.txt
```

While this is optional, let's also create `src` and move the `__main__.py` in it. To let Pulumi know where the main file is located, add the following in `Pulumi.yaml`

```
main: src
```

Let's see if everything is setup fine by running

```
pulumi preview
```

If all's good let's go to the main file and remove any default code (in my case s3 bucket). And create a new file `utils.py` which contains a helper function to name our resources attaching project and stack name as a prefix. This helps with maintaining uniqueness of names when you have multiple resources based on different projects in your aws account.

```
import pulumi

PROJECT_NAME = pulumi.get_project()
STACK_NAME = pulumi.get_stack()


def prefix_name(name: str = "") -> str:
    prefix = f"{PROJECT_NAME}-{STACK_NAME}"
    return prefix if name == "" else f"{prefix}-{name}"

```

### Pulumi: aws resources

Let's create `aws` directory that'll contain all the resources. Each resource is defined as a class and initialized in `__main__.py`. Since there's a lot of code, I'd prefer not to copy it all here as it can be accessed in the github repository. However we'll walk through all of them one by one.

#### ecs_cluster.py

This is the cluster in which we'll run both the server and worker services as well as the flow fargate container. We've enabled `containerInsights` as that'll help us monitor resource consumption of the latter.

#### ecr_repository.py

ECR repository will be used to save and retrieve flow docker images. We've also set the lifecyle rules so that older images are automatically deleted. Note the repository name is simply `prefix_name()` which'll return `prefect-work-pool-hosting-demo-dev` in our case. The idea here is that in future we may build and deploy multiple flows and we can upload all of them in the same repository, differentiating with tag such as `mean_and_median-latest`.

#### fargate_sg.py

The security group to be attached to the flow fargate container which disallows all incoming traffic.

#### ec2_instance.py

Now this is a big one. This is the instance that'll run the server and worker containers. Since both are rather lightweight we can run both in a T4g.small instance. Of course if you have more internal users accessing the server or several workers you may need a bigger machine.

First of all we create a role with permissions to register and execute a Fargate task which will be needed by the worker process.

Next we pass a bash script as `user_data` which installs and runs the `ecs-agent` which is required in non Amazon linux distros to register an EC2 instance in ECS. Without it ECS won't be able to run managed containers in the instance. It also installs a desktop environment `xfce` which we'll need when we want to access the server UI via RDP. This script will only run when the instance is first initialized.

Finally we create a security group  and set up the EC2 instance. Notice the ingress rules of the security group; it allows incoming traffic from the fargate security group. This is needed to allow the flow process to be able to communicate with the server.

#### ecs_task_execution_role.py

This is the role that we'll assign to server, worker as well as the flow process. Ideally we should attach more granular permissions and perhaps not all 3 of the processes require the same permissions at all so we'd have different roles in that case. But for simplicity we'll go ahead with this.

#### server_ecs_service.py

The task definition for the service using the official latest Prefect docker image. We've mounted a volume so that data is persisted even if the service restarts. It's important to note our server will be storing all the data in a sqlite database that prefect enables by default. Postgres is also supported and in fact recommended in the docs for production workload but we'll use the default sqlite to keep things simple. If you want to use postgres follow the [docs](https://docs.prefect.io/latest/guides/host/#configure-a-postgresql-database) and add the required the env variable in the task definition.

#### worker_ecs_service.py

This is very similar to the server. In the env we set the api url to localhost since both the processes are running in the same machine.