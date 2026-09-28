import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ForgetChangeAuthorResT, ListChangesResT, RevertChangeResT } from '../../../../../types';
import { AdminGuard } from '../../../AuthModule/guards/admin.guard';
import { EnChangesService } from './enChanges.service';
import { ForgetChangeAuthorReqDTO } from './dto/ForgetChangeAuthorReq.dto';
import { ListChangesQueryDTO } from './dto/ListChangesQuery.dto';

/**
 * The history of the edits of the active dataset (issue #531), admin only:
 * everything that was changed, what no longer shows included. Registered
 * before EnController so the routes are not swallowed by GET /api/en/:id
 */
@ApiTags('En_Changes')
@Controller('/api/en/changes')
export class EnChangesController {
  constructor(private readonly enChangesService: EnChangesService) {}

  @UseGuards(AdminGuard)
  @Get()
  async list(@Query() query: ListChangesQueryDTO): Promise<ListChangesResT> {
    return this.enChangesService.list(query);
  }

  // A name is personal data: whoever gave it may ask for it to be taken out
  @UseGuards(AdminGuard)
  @HttpCode(200)
  @Post('forget-author')
  async forgetAuthor(@Body() body: ForgetChangeAuthorReqDTO): Promise<ForgetChangeAuthorResT> {
    return this.enChangesService.forgetAuthor(body.author);
  }

  @UseGuards(AdminGuard)
  @HttpCode(200)
  @Post(':id/revert')
  async revert(@Param('id', ParseIntPipe) id: number): Promise<RevertChangeResT> {
    return this.enChangesService.revert(id);
  }
}
